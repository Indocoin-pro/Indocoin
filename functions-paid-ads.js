/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║     INDOCOIN PAID ADS — FIREBASE CLOUD FUNCTIONS             ║
 * ║     functions/index.js                                       ║
 * ║                                                              ║
 * ║  Install: npm install firebase-functions firebase-admin      ║
 * ║  Deploy : firebase deploy --only functions                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");
admin.initializeApp();

const db   = admin.firestore();
const auth = admin.auth();

// ─────────────────────────────────────────────
//  CRON: Cek expire setiap hari jam 08:00 WIB
//  Schedule: "0 1 * * *" (01:00 UTC = 08:00 WIB)
// ─────────────────────────────────────────────
exports.checkAdExpiry = functions.pubsub
  .schedule("0 1 * * *")
  .timeZone("Asia/Jakarta")
  .onRun(async () => {
    const now       = Date.now();
    const in7Days   = now + 7 * 24 * 60 * 60 * 1000;
    const snapshot  = await db.collection("paidAds")
      .where("active", "==", true)
      .get();

    const batch     = db.batch();
    const promises  = [];

    for (const docSnap of snapshot.docs) {
      const data    = docSnap.data();
      const uid     = docSnap.id;
      const expiry  = data.expiresAt?.toMillis
        ? data.expiresAt.toMillis()
        : new Date(data.expiresAt).getTime();

      // ── 1. Iklan sudah expired → nonaktifkan ──
      if (expiry < now) {
        batch.update(docSnap.ref, { active: false });
        batch.update(db.collection("paidAdsPublic").doc(uid), { active: false });

        // Kirim notif expired
        promises.push(sendNotification(uid, {
          title : "⚠️ Iklan Kamu Sudah Berakhir",
          body  : `Iklan ${data.namaUsaha} telah berakhir. Perpanjang sekarang agar toko tetap tampil di platform Indocoin.`,
          type  : "expired",
          action: "paid-ads-seller.html",
        }));
        continue;
      }

      // ── 2. Iklan expire dalam 7 hari & belum kirim notif ──
      if (expiry <= in7Days && !data.expireNotifSent) {
        const daysLeft = Math.ceil((expiry - now) / 86_400_000);

        batch.update(docSnap.ref, { expireNotifSent: true });

        // In-app notification
        promises.push(sendNotification(uid, {
          title : `⏰ Iklan Berakhir ${daysLeft} Hari Lagi`,
          body  : `Iklan ${data.namaUsaha} akan berakhir dalam ${daysLeft} hari. Perpanjang sekarang!`,
          type  : "expire_warning",
          action: "paid-ads-seller.html",
          daysLeft,
        }));

        // Email notification
        promises.push(sendEmail(uid, data, daysLeft));
      }

      // ── 3. Reset flag jika sudah diperpanjang ──
      if (data.expireNotifSent && expiry > in7Days) {
        batch.update(docSnap.ref, { expireNotifSent: false });
      }
    }

    await batch.commit();
    await Promise.allSettled(promises);

    console.log(`✅ Expire check done. Processed: ${snapshot.size} ads.`);
    return null;
  });

// ─────────────────────────────────────────────
//  HELPER: Kirim In-App Notification
// ─────────────────────────────────────────────
async function sendNotification(uid, payload) {
  try {
    await db.collection("notifications").add({
      uid      : uid,
      title    : payload.title,
      body     : payload.body,
      type     : payload.type,
      action   : payload.action || null,
      daysLeft : payload.daysLeft || null,
      read     : false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // FCM Push (jika user sudah daftar FCM token)
    const tokenSnap = await db.collection("fcmTokens").doc(uid).get();
    if (tokenSnap.exists()) {
      const token = tokenSnap.data().token;
      if (token) {
        await admin.messaging().send({
          token,
          notification: { title: payload.title, body: payload.body },
          data        : { action: payload.action || "", type: payload.type },
          android     : { notification: { sound: "default" } },
          apns        : { payload: { aps: { sound: "default" } } },
        });
      }
    }
  } catch (e) {
    console.error(`Notif error for ${uid}:`, e.message);
  }
}

// ─────────────────────────────────────────────
//  HELPER: Kirim Email via Firebase Auth Email
//  (Gunakan SendGrid atau Nodemailer untuk produksi)
// ─────────────────────────────────────────────
async function sendEmail(uid, adData, daysLeft) {
  try {
    const userRecord = await auth.getUser(uid);
    const email      = userRecord.email;
    if (!email) return;

    const fees = { UMKM:1825000, UD:3650000, CV:10950000, PT:18250000 };
    const fee  = fees[adData.kategori] || 0;
    const usd  = (fee * 0.003).toFixed(2);

    // Simpan email task ke Firestore untuk diproses oleh email service
    // (Integrate dengan SendGrid Extension atau custom SMTP)
    await db.collection("emailQueue").add({
      to      : email,
      subject : `⏰ Iklan Indocoin Kamu Berakhir ${daysLeft} Hari Lagi`,
      html    : `
<!DOCTYPE html>
<html>
<body style="background:#0a0f1e;color:#e2e8f0;font-family:Arial,sans-serif;padding:20px;max-width:600px;margin:0 auto;">
  <div style="background:#162032;border:1px solid rgba(250,204,21,0.2);border-radius:16px;padding:24px;">
    <div style="text-align:center;margin-bottom:20px;">
      <h1 style="font-family:monospace;color:#facc15;letter-spacing:2px;">INDOCOIN</h1>
      <p style="color:#64748b;font-size:12px;letter-spacing:1px;">PAID AD SPACE</p>
    </div>
    <h2 style="color:#facc15;font-size:18px;">⏰ Iklan Kamu Akan Berakhir!</h2>
    <p style="color:#94a3b8;line-height:1.6;margin:12px 0;">
      Hei, iklan toko <strong style="color:#fff;">${adData.namaUsaha}</strong> di platform Indocoin
      akan berakhir dalam <strong style="color:#facc15;">${daysLeft} hari</strong>.
    </p>
    <div style="background:rgba(250,204,21,0.08);border:1px solid rgba(250,204,21,0.2);border-radius:12px;padding:16px;margin:16px 0;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#64748b;">Nama Toko</span>
        <span style="color:#fff;font-weight:700;">${adData.namaUsaha}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#64748b;">Kategori</span>
        <span style="color:#facc15;">${adData.kategori}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#64748b;">Biaya Perpanjang</span>
        <span style="color:#facc15;font-weight:700;">${fee.toLocaleString('id-ID')} INDC</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:#64748b;">Estimasi USD</span>
        <span style="color:#22c55e;">≈ $${usd}</span>
      </div>
    </div>
    <a href="https://indocoin-network.web.app/paid-ads-seller.html"
       style="display:block;background:linear-gradient(135deg,#facc15,#f59e0b);color:#000;text-decoration:none;
              text-align:center;padding:14px;border-radius:12px;font-weight:700;font-family:monospace;
              letter-spacing:2px;margin:16px 0;">
      🚀 PERPANJANG SEKARANG
    </a>
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:16px;">
      Jika kamu tidak ingin menerima email ini, abaikan saja.<br>
      © 2026 Indocoin Network
    </p>
  </div>
</body>
</html>`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sent     : false,
    });

    console.log(`📧 Email queued for ${email}`);
  } catch (e) {
    console.error(`Email error for ${uid}:`, e.message);
  }
}

// ─────────────────────────────────────────────
//  TRIGGER: Notif saat iklan baru terdaftar
// ─────────────────────────────────────────────
exports.onAdRegistered = functions.firestore
  .document("paidAds/{uid}")
  .onCreate(async (snap, context) => {
    const uid  = context.params.uid;
    const data = snap.data();

    await sendNotification(uid, {
      title : "🎉 Iklan Kamu Berhasil Terdaftar!",
      body  : `${data.namaUsaha} sudah aktif di platform Indocoin. Pilih desain banner sekarang!`,
      type  : "registered",
      action: "paid-ads-banner-picker.html",
    });

    return null;
  });

// ─────────────────────────────────────────────
//  TRIGGER: Notif saat iklan diperpanjang
// ─────────────────────────────────────────────
exports.onAdRenewed = functions.firestore
  .document("paidAds/{uid}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after  = change.after.data();
    const uid    = context.params.uid;

    const exBefore = before.expiresAt?.toMillis?.() || 0;
    const exAfter  = after.expiresAt?.toMillis?.()  || 0;

    if (exAfter > exBefore + 86_400_000) { // expire diperpanjang > 1 hari
      const newExpiry = new Date(exAfter).toLocaleDateString('id-ID');
      await sendNotification(uid, {
        title : "✅ Iklan Berhasil Diperpanjang!",
        body  : `Iklan ${after.namaUsaha} aktif hingga ${newExpiry}. Terima kasih!`,
        type  : "renewed",
        action: "paid-ads-seller.html",
      });
    }

    return null;
  });
