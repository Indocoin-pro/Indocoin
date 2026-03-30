/**
 * SANJAYA NOTIF SYSTEM — Realtime Notification via Firebase Firestore
 * Pasang di semua halaman platform (kecuali login & landing)
 * 
 * Cara pakai: tambahkan di akhir <body>:
 *   <script src="sanjaya-notif.js"></script>
 */

(function(){
'use strict';

// ═══ FIREBASE CONFIG (sama dengan platform Indocoin) ═══
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBrhDJiIcEJsZ-fN0RIDlV0XaOA8ZPjJsw",
  authDomain: "indocoin-network.firebaseapp.com",
  projectId: "indocoin-network",
  storageBucket: "indocoin-network.firebasestorage.app",
  messagingSenderId: "742922450154",
  appId: "1:742922450154:web:97e0847e85bfe3e9f9d393"
};

// ═══ CSS ═══
const CSS = `
#sj-notif-container {
  position: fixed;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse;
  gap: 6px;
  width: min(340px, 92vw);
  pointer-events: none;
}
.sj-notif {
  background: rgba(10, 15, 30, 0.97);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(250, 204, 21, 0.35);
  border-radius: 14px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: all;
  cursor: pointer;
  animation: sj-notif-in 0.35s cubic-bezier(.34,1.56,.64,1);
  box-shadow: 0 4px 24px rgba(0,0,0,0.6), 0 0 12px rgba(250,204,21,0.1);
  position: relative;
  overflow: hidden;
}
.sj-notif.removing {
  animation: sj-notif-out 0.3s ease forwards;
}
@keyframes sj-notif-in {
  from { opacity:0; transform:translateY(16px) scale(0.95); }
  to   { opacity:1; transform:translateY(0) scale(1); }
}
@keyframes sj-notif-out {
  from { opacity:1; transform:translateY(0) scale(1); }
  to   { opacity:0; transform:translateY(10px) scale(0.95); }
}
.sj-notif-progress {
  position: absolute;
  bottom: 0; left: 0;
  height: 2px;
  background: linear-gradient(90deg, #facc15, #f59e0b);
  border-radius: 0 0 14px 14px;
  animation: sj-progress linear forwards;
}
@keyframes sj-progress {
  from { width: 100%; }
  to   { width: 0%; }
}
.sj-notif-icon {
  font-size: 28px;
  flex-shrink: 0;
  filter: drop-shadow(0 0 6px rgba(250,204,21,0.5));
}
.sj-notif-body { flex: 1; min-width: 0; }
.sj-notif-title {
  font-family: 'Orbitron', 'Cinzel', sans-serif;
  font-size: 10px;
  font-weight: 700;
  color: #facc15;
  letter-spacing: 1px;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sj-notif-msg {
  font-family: 'Rajdhani', 'Crimson Text', sans-serif;
  font-size: 12px;
  color: #e2e8f0;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sj-notif-action {
  font-family: 'Orbitron', sans-serif;
  font-size: 8px;
  font-weight: 700;
  color: #000;
  background: linear-gradient(135deg, #facc15, #f59e0b);
  border: none;
  border-radius: 8px;
  padding: 5px 10px;
  cursor: pointer;
  flex-shrink: 0;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
.sj-notif-close {
  position: absolute;
  top: 6px; right: 8px;
  font-size: 10px;
  color: #64748b;
  cursor: pointer;
  line-height: 1;
}
.sj-notif-close:hover { color: #facc15; }

/* Room status badge */
.sj-room-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: 'Orbitron', sans-serif;
  font-size: 7px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 10px;
  margin-top: 3px;
}
.sj-room-badge.waiting {
  background: rgba(250,204,21,0.15);
  border: 1px solid rgba(250,204,21,0.3);
  color: #facc15;
}
.sj-room-badge.starting {
  background: rgba(52,211,153,0.15);
  border: 1px solid rgba(52,211,153,0.3);
  color: #34d399;
}
.sj-dot-pulse {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: sj-dot-blink 1s infinite;
}
@keyframes sj-dot-blink { 0%,100%{opacity:1}50%{opacity:0.2} }
`;

// ═══ INIT ═══
let db = null;
let auth = null;
let currentUser = null;
let unsubscribeRooms = null;
let shownRooms = new Set();

function injectCSS() {
  if (document.getElementById('sj-notif-css')) return;
  const s = document.createElement('style');
  s.id = 'sj-notif-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function createContainer() {
  if (document.getElementById('sj-notif-container')) return;
  const el = document.createElement('div');
  el.id = 'sj-notif-container';
  document.body.appendChild(el);
}

// ═══ SHOW NOTIFICATION ═══
function showNotif({ icon, title, msg, badge, actionText, actionUrl, duration = 5000 }) {
  const container = document.getElementById('sj-notif-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'sj-notif';
  el.innerHTML = `
    <span class="sj-notif-close" onclick="this.closest('.sj-notif').remove()">✕</span>
    <div class="sj-notif-icon">${icon}</div>
    <div class="sj-notif-body">
      <div class="sj-notif-title">${title}</div>
      <div class="sj-notif-msg">${msg}</div>
      ${badge ? `<div class="sj-room-badge ${badge.type}"><span class="sj-dot-pulse"></span>${badge.text}</div>` : ''}
    </div>
    ${actionText ? `<button class="sj-notif-action">${actionText}</button>` : ''}
    <div class="sj-notif-progress" style="animation-duration:${duration}ms"></div>
  `;

  // Action button click
  if (actionText && actionUrl) {
    el.querySelector('.sj-notif-action').onclick = () => {
      window.location.href = actionUrl;
    };
    el.onclick = (e) => {
      if (!e.target.classList.contains('sj-notif-close')) {
        window.location.href = actionUrl;
      }
    };
  }

  container.appendChild(el);

  // Sound notif
  if (window.SanjayaSound) window.SanjayaSound.sfx.notify();

  // Auto remove
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ═══ LISTEN ROOMS (Firestore realtime) ═══
function listenRooms() {
  if (!db || !currentUser) return;

  // Unsubscribe sebelumnya
  if (unsubscribeRooms) unsubscribeRooms();

  try {
    const { collection, query, where, onSnapshot, orderBy, limit } =
      window.firestoreSDK;

    const roomsRef = collection(db, 'sanjaya_rooms');
    const q = query(
      roomsRef,
      where('status', '==', 'waiting'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    unsubscribeRooms = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added' || change.type === 'modified') {
          const room = change.doc.data();
          const roomId = change.doc.id;

          // Jangan notif room milik sendiri atau yang sudah pernah ditampilkan
          if (room.creatorUid === currentUser.uid) return;
          if (shownRooms.has(roomId + room.playerCount)) return;
          shownRooms.add(roomId + room.playerCount);

          const playerCount = room.playerCount || 1;
          const needed = (room.maxPlayers || 4) - playerCount;
          const isStarting = playerCount >= 2;

          // Jangan tampilkan kalau room sudah penuh
          if (needed <= 0) return;

          const creator = room.creatorName || 'Ksatria';
          const fee = room.entryFee
            ? (parseFloat(room.entryFee) / 1e18).toFixed(0) + ' INDC'
            : '—';

          showNotif({
            icon: '⚔️',
            title: '🏰 SINGGASANA SANJAYA',
            msg: `${creator} membuka room! Fee: ${fee} · ${playerCount}/${room.maxPlayers||4} pemain`,
            badge: isStarting
              ? { type: 'starting', text: `Butuh ${needed} lagi — segera!` }
              : { type: 'waiting', text: `Menunggu pemain (${playerCount}/${room.maxPlayers||4})` },
            actionText: 'GABUNG!',
            actionUrl: `sanjaya.html?roomId=${roomId}`,
            duration: 5000
          });
        }
      });
    }, (err) => {
      console.warn('SanjayaNotif: Firestore error', err.message);
    });
  } catch(e) {
    console.warn('SanjayaNotif: listenRooms error', e.message);
  }
}

// ═══ INIT FIREBASE ═══
async function initFirebase() {
  // Tunggu Firebase SDK tersedia (sudah dimuat oleh halaman)
  let tries = 0;
  while (!window.firebase && tries < 20) {
    await new Promise(r => setTimeout(r, 300));
    tries++;
  }

  try {
    // Pakai Firebase yang sudah ada di halaman
    const { initializeApp, getApps } = window.firebaseAppSDK || {};
    const { getFirestore } = window.firestoreSDK || {};
    const { getAuth, onAuthStateChanged } = window.firebaseAuthSDK || {};

    if (!getFirestore || !getAuth) {
      // Load Firestore SDK dinamis
      await loadFirebaseSDK();
      return;
    }

    const apps = getApps ? getApps() : [];
    const app = apps.length > 0 ? apps[0] : initializeApp(FIREBASE_CONFIG);
    db   = getFirestore(app);
    auth = getAuth(app);

    onAuthStateChanged(auth, user => {
      currentUser = user;
      if (user) listenRooms();
      else if (unsubscribeRooms) { unsubscribeRooms(); unsubscribeRooms = null; }
    });

  } catch(e) {
    console.warn('SanjayaNotif: Firebase init error', e.message);
    await loadFirebaseSDK();
  }
}

// Load Firebase SDK secara dinamis jika belum ada
async function loadFirebaseSDK() {
  try {
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js');
    const firestoreMod = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js');
    const authMod      = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js');

    window.firestoreSDK    = firestoreMod;
    window.firebaseAuthSDK = authMod;

    const apps = getApps();
    const app  = apps.length > 0 ? apps[0] : initializeApp(FIREBASE_CONFIG);

    db   = firestoreMod.getFirestore(app);
    auth = authMod.getAuth(app);

    authMod.onAuthStateChanged(auth, user => {
      currentUser = user;
      if (user) listenRooms();
    });

  } catch(e) {
    console.warn('SanjayaNotif: SDK load error', e.message);
  }
}

// ═══ PUBLIC API ═══
// Bisa dipanggil manual dari halaman manapun
window.SanjayaNotif = {
  // Tampilkan notif custom
  show: showNotif,

  // Notif saat room dibuat (dipanggil dari sanjaya.html)
  roomCreated: (roomId, fee, creatorName) => {
    // Tulis ke Firestore agar semua user dapat notif
    if (!db || !currentUser) return;
    try {
      const { collection, addDoc, serverTimestamp } = window.firestoreSDK;
      addDoc(collection(db, 'sanjaya_rooms'), {
        roomId,
        creatorUid: currentUser.uid,
        creatorName: creatorName || currentUser.displayName || 'Ksatria',
        entryFee: fee,
        playerCount: 1,
        maxPlayers: 4,
        status: 'waiting',
        createdAt: serverTimestamp()
      });
    } catch(e) { console.warn('roomCreated error:', e.message); }
  },

  // Update jumlah pemain di room
  updateRoomPlayers: async (firestoreRoomId, playerCount, status) => {
    if (!db) return;
    try {
      const { doc, updateDoc } = window.firestoreSDK;
      await updateDoc(doc(db, 'sanjaya_rooms', firestoreRoomId), {
        playerCount,
        status: status || (playerCount >= 4 ? 'full' : 'waiting')
      });
    } catch(e) { console.warn('updateRoomPlayers error:', e.message); }
  },

  // Hapus room dari Firestore saat selesai
  deleteRoom: async (firestoreRoomId) => {
    if (!db) return;
    try {
      const { doc, deleteDoc } = window.firestoreSDK;
      await deleteDoc(doc(db, 'sanjaya_rooms', firestoreRoomId));
    } catch(e) {}
  },

  // Akses db & currentUser
  getDb: () => db,
  getUser: () => currentUser,

  // Tunggu sampai Firebase Auth selesai cek session (max 5 detik)
  waitForUser: () => new Promise(resolve => {
    if (currentUser !== null) { resolve(currentUser); return; }
    let tries = 0;
    const interval = setInterval(() => {
      tries++;
      if (currentUser !== null || tries >= 25) {
        clearInterval(interval);
        resolve(currentUser);
      }
    }, 200);
  })
};

// ═══ START ═══
injectCSS();
createContainer();
document.addEventListener('DOMContentLoaded', initFirebase);
if (document.readyState !== 'loading') initFirebase();

})();
