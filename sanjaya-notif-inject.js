/**
 * SANJAYA NOTIF INJECT — Pasang di semua halaman platform Indocoin
 * (kecuali halaman login & landing)
 * 
 * Cara pakai — tambahkan 1 baris ini di akhir <body> setiap halaman:
 *   <script src="sanjaya-notif.js"></script>
 * 
 * File ini adalah dokumentasi cara pemasangan.
 * Yang perlu ditambahkan ke setiap halaman platform:
 * 
 * ════════════════════════════════════════
 * HALAMAN YANG PERLU DITAMBAHKAN:
 * ════════════════════════════════════════
 * 
 * dashboard.html     ✅ tambahkan
 * permainan.html     ✅ tambahkan
 * wallet.html        ✅ tambahkan
 * profile.html       ✅ tambahkan
 * leaderboard.html   ✅ tambahkan
 * battle-arena.html  ✅ tambahkan
 * tournament.html    ✅ tambahkan
 * guild.html         ✅ tambahkan
 * 
 * HALAMAN YANG TIDAK PERLU:
 * landing.html       ❌ skip
 * login.html         ❌ skip
 * register.html      ❌ skip
 * 
 * ════════════════════════════════════════
 * KODE YANG DITAMBAHKAN (sebelum </body>):
 * ════════════════════════════════════════
 * 
 * <script src="sanjaya-notif.js"></script>
 * 
 * ════════════════════════════════════════
 * SETUP FIRESTORE (1x di Firebase Console):
 * ════════════════════════════════════════
 * 
 * 1. Buka Firebase Console → Firestore Database
 * 2. Buat collection: "sanjaya_rooms"
 * 3. Set Rules:
 * 
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     match /sanjaya_rooms/{roomId} {
 *       allow read: if request.auth != null;
 *       allow create: if request.auth != null;
 *       allow update, delete: if request.auth != null && 
 *         request.auth.uid == resource.data.creatorUid;
 *     }
 *   }
 * }
 * 
 * ════════════════════════════════════════
 */

// File ini hanya dokumentasi.
// Yang perlu dijalankan adalah sanjaya-notif.js
console.log('[SanjayaNotif] Inject guide loaded. Add <script src="sanjaya-notif.js"></script> to your pages.');
