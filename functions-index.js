/* SHULESMART - Cloud Functions (msingi wa malipo ya Selcom STK Push)
   ==================================================================
   MAELEKEZO KABLA YA KUTUMIA:
   1. Weka faili hii kwenye folder "functions/index.js" ya mradi wako wa Firebase
      (firebase init functions ukiwa bado hujafanya).
   2. Weka Firebase kwenye "Blaze plan" (inahitajika kwa Cloud Functions
      kuwasiliana na mtandao wa nje kama Selcom).
   3. Weka siri za Selcom (API Key, API Secret, Vendor ID) kwa amri:
        firebase functions:config:set selcom.vendor="VENDOR_ID" selcom.apikey="API_KEY" selcom.apisecret="API_SECRET"
      (kamwe usiziweke moja kwa moja kwenye faili hii wala kwenye index.html)
   4. `firebase deploy --only functions`
   5. Badilisha URL ya "paymentWebhook" iliyotolewa baada ya deploy kwenye
      Dashibodi ya Selcom (Webhook/Callback URL settings).

   Faili hii ni MSINGI (scaffold) - bado inahitaji majaribio halisi na Selcom
   sandbox kabla ya kwenda "live", pamoja na kusoma API docs za Selcom kwa
   endpoint sahihi za "Order Create" (STK push) kwa mwaka huu. */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const SELCOM_BASE_URL = "https://apigw.selcommobile.com"; // hakiki URL sahihi kwenye docs za Selcom
const VENDOR = functions.config().selcom?.vendor;
const API_KEY = functions.config().selcom?.apikey;
const API_SECRET = functions.config().selcom?.apisecret;

const DAY_MS = 24 * 60 * 60 * 1000;

/* Bei za vifurushi - lazima zilingane na PACKAGES kwenye index.html.
   Kuweka bei hapa (server-side) ni MUHIMU kwa usalama: mteja hawezi
   kubadilisha kiasi cha kulipa kwa kubadilisha JavaScript kwenye browser,
   kwa sababu Cloud Function ndiyo inayoamua bei halisi, si HTML. */
const PACKAGES = {
  1: 20000,
  3: 55000,
  6: 105000,
  12: 200000
};

function generateSelcomHeaders(payloadString) {
  // Selcom inahitaji "signature" ya HMAC-SHA256 kwa kila ombi.
  // Angalia "Selcom API Reference - Authentication" kwa muundo kamili
  // (order ya fields inayotakiwa kwenye signed-fields inaweza kubadilika).
  const timestamp = new Date().toISOString();
  const signedFields = "timestamp";
  const dataToSign = `timestamp=${timestamp}`;
  const signature = crypto
    .createHmac("sha256", API_SECRET)
    .update(dataToSign)
    .digest("base64");

  return {
    "Content-Type": "application/json",
    Authorization: `SELCOM ${Buffer.from(API_KEY).toString("base64")}`,
    "Digest-Method": "HS256",
    Digest: signature,
    Timestamp: timestamp,
    "Signed-Fields": signedFields,
  };
}

/* 1) initiatePayment - inaitwa na app (HTML) mtumiaji akibonyeza "LIPIA SASA".
   Haipokei kiasi kutoka kwa mteja - inakihesabu yenyewe kutoka PACKAGES
   kwa kutumia "months" pekee, ili kuzuia udanganyifu wa bei. */
exports.initiatePayment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Lazima uwe umeingia.");
  }

  const months = Number(data.months);
  const amount = PACKAGES[months];
  if (!amount) {
    throw new functions.https.HttpsError("invalid-argument", "Kifurushi si sahihi.");
  }

  const uid = context.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Akaunti haikupatikana.");
  }
  const userData = userDoc.data();
  const phone = (userData.phone || "").replace(/\D/g, "");
  if (!phone) {
    throw new functions.https.HttpsError("failed-precondition", "Weka namba ya simu kwenye Settings kwanza.");
  }

  const orderId = `SS-${uid.substring(0, 6)}-${Date.now()}`;

  // Rekodi ya muda ("pending") KABLA ya kutuma STK, ili webhook ijue
  // ni ombi lipi la kulihusisha (na months ngapi za kuongeza baadaye).
  await db.collection("payments").doc(orderId).set({
    uid,
    months,
    amount,
    phone,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const payload = {
    vendor: VENDOR,
    order_id: orderId,
    buyer_email: userData.email || "",
    buyer_name: userData.schoolName || "",
    buyer_phone: phone,
    amount: amount,
    currency: "TZS",
    no_of_items: 1,
    webhook: functions.config().app?.webhook_url, // weka URL ya paymentWebhook hapa
  };

  try {
    const response = await axios.post(
      `${SELCOM_BASE_URL}/v1/checkout/create-order-minimal`, // hakiki endpoint sahihi kwenye Selcom docs
      payload,
      { headers: generateSelcomHeaders(JSON.stringify(payload)) }
    );
    return { success: true, orderId, selcomResponse: response.data };
  } catch (error) {
    console.error("Selcom error:", error.response?.data || error.message);
    await db.collection("payments").doc(orderId).update({ status: "failed" });
    throw new functions.https.HttpsError("internal", "Imeshindikana kutuma ombi la malipo.");
  }
});

/* 2) paymentWebhook - Selcom inaita hii moja kwa moja baada ya mteja
   kuweka PIN kwenye simu yake na kukamilisha malipo. HAKUNA binadamu
   anayehusika hapa - ni server-to-server pekee. */
exports.paymentWebhook = functions.https.onRequest(async (req, res) => {
  try {
    // TODO: thibitisha "signature" ya Selcom kwenye req.headers kabla ya
    // kuamini data - vinginevyo mtu yeyote angeweza kuiga webhook hii.

    const { order_id: orderId, payment_status: paymentStatus } = req.body;
    if (!orderId) return res.status(400).send("Missing order_id");

    const paymentRef = db.collection("payments").doc(orderId);
    const paymentDoc = await paymentRef.get();
    if (!paymentDoc.exists) return res.status(404).send("Order not found");

    const payment = paymentDoc.data();
    if (payment.status === "completed") {
      return res.status(200).send("Already processed"); // zuia kuongeza mara mbili
    }

    if (paymentStatus !== "COMPLETED") {
      await paymentRef.update({ status: "failed" });
      return res.status(200).send("Payment not completed");
    }

    const userRef = db.collection("users").doc(payment.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    const now = Date.now();
    let baseMillis = now;
    if (userData.subscriptionEndDate && userData.subscriptionEndDate.toMillis) {
      baseMillis = Math.max(userData.subscriptionEndDate.toMillis(), now);
    }
    const newEndMillis = baseMillis + payment.months * 30 * DAY_MS;

    await userRef.update({
      subscriptionStatus: "active",
      subscriptionEndDate: admin.firestore.Timestamp.fromMillis(newEndMillis),
    });

    await paymentRef.update({
      status: "completed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).send("Server error");
  }
});
