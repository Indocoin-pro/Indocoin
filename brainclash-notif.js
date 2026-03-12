/**
 * INDC BrainClash — Global Notification System
 * Inject ke semua halaman platform
 * Firebase listen → popup muncul saat ada room baru
 */
(function(){
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey:"AIzaSyExample",
    authDomain:"indocoin.firebaseapp.com",
    databaseURL:"https://indocoin-default-rtdb.firebaseio.com",
    projectId:"indocoin"
  };

  const CATEGORIES = ['🔬 Sains','➗ Matematika','💻 Teknologi','🌍 Pengetahuan Umum','📜 Sejarah','💰 Ekonomi'];
  const BRAINCLASH_URL = 'brainclash.html';

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    #bc-notif-wrap {
      position:fixed;bottom:80px;right:16px;z-index:99999;
      display:flex;flex-direction:column;gap:10px;pointer-events:none;
    }
    .bc-notif {
      pointer-events:all;
      background:linear-gradient(135deg,#0a1a0a 0%,#0d2b0d 100%);
      border:1px solid #00ff4120;
      border-left:3px solid #00ff41;
      border-radius:12px;
      padding:14px 16px;
      min-width:300px;max-width:340px;
      box-shadow:0 8px 32px rgba(0,255,65,0.15),0 0 0 1px rgba(0,255,65,0.05);
      font-family:'Share Tech Mono',monospace;
      animation:bc-slidein 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards;
      position:relative;overflow:hidden;
    }
    .bc-notif::before {
      content:'';position:absolute;top:0;left:0;right:0;height:1px;
      background:linear-gradient(90deg,transparent,#00ff41,transparent);
    }
    .bc-notif-header {
      display:flex;align-items:center;gap:8px;margin-bottom:8px;
    }
    .bc-notif-badge {
      background:#00ff4115;border:1px solid #00ff4140;
      color:#00ff41;font-size:9px;letter-spacing:2px;
      padding:2px 8px;border-radius:4px;font-weight:700;
    }
    .bc-notif-timer {
      margin-left:auto;color:#00ff4180;font-size:10px;
    }
    .bc-notif-category {
      font-size:13px;color:#e0ffe0;margin-bottom:4px;font-weight:700;
    }
    .bc-notif-meta {
      display:flex;align-items:center;gap:10px;margin-bottom:10px;
    }
    .bc-notif-pot {
      color:#00ff41;font-size:12px;font-weight:700;
    }
    .bc-notif-players {
      color:#88cc88;font-size:11px;
    }
    .bc-notif-creator {
      color:#66aa66;font-size:10px;margin-bottom:10px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    }
    .bc-notif-progress {
      height:2px;background:#00ff4120;border-radius:2px;margin-bottom:10px;
      overflow:hidden;
    }
    .bc-notif-progress-bar {
      height:100%;background:#00ff41;width:100%;
      transition:width linear;border-radius:2px;
    }
    .bc-notif-btns {
      display:flex;gap:8px;
    }
    .bc-btn-join {
      flex:1;background:#00ff41;color:#000;border:none;
      border-radius:6px;padding:8px;font-family:'Share Tech Mono',monospace;
      font-size:11px;font-weight:700;cursor:pointer;letter-spacing:1px;
      transition:all 0.2s;
    }
    .bc-btn-join:hover { background:#00cc33;transform:scale(1.02); }
    .bc-btn-close {
      background:transparent;border:1px solid #00ff4130;color:#00ff4170;
      border-radius:6px;padding:8px 12px;cursor:pointer;font-size:11px;
      font-family:'Share Tech Mono',monospace;transition:all 0.2s;
    }
    .bc-btn-close:hover { border-color:#00ff4160;color:#00ff41; }
    .bc-notif.bc-exit {
      animation:bc-slideout 0.3s ease-in forwards;
    }
    @keyframes bc-slidein {
      from { opacity:0;transform:translateX(120%); }
      to   { opacity:1;transform:translateX(0); }
    }
    @keyframes bc-slideout {
      from { opacity:1;transform:translateX(0); }
      to   { opacity:0;transform:translateX(120%); }
    }
    .bc-pip {
      display:inline-block;width:6px;height:6px;border-radius:50%;
      background:#00ff41;margin-right:4px;
      animation:bc-blink 1s infinite;
    }
    @keyframes bc-blink {
      0%,100%{opacity:1}50%{opacity:0.3}
    }
  `;
  document.head.appendChild(style);

  // Inject container
  const wrap = document.createElement('div');
  wrap.id = 'bc-notif-wrap';
  document.body.appendChild(wrap);

  // Notif yang sudah ditampilkan
  const shown = new Set();

  function showNotif(room) {
    if (shown.has(room.id)) return;
    shown.add(room.id);

    const cat = CATEGORIES[room.categoryId] || '🔬 Sains';
    const pot = Math.floor(room.pot / 1e9).toLocaleString();
    const creator = room.creatorName || (room.creator ? room.creator.slice(0,6)+'...'+room.creator.slice(-4) : 'Challenger');

    const el = document.createElement('div');
    el.className = 'bc-notif';
    el.innerHTML = `
      <div class="bc-notif-header">
        <span class="bc-notif-badge">⚗️ BRAINCLASH</span>
        <span class="bc-notif-timer" id="bct-${room.id}">5s</span>
      </div>
      <div class="bc-notif-category">${cat}</div>
      <div class="bc-notif-meta">
        <span class="bc-notif-pot">💰 ${pot} INDC</span>
        <span class="bc-notif-players"><span class="bc-pip"></span>${room.playerCount}/4 player</span>
      </div>
      <div class="bc-notif-creator">🧪 ${creator} menantang kamu!</div>
      <div class="bc-notif-progress">
        <div class="bc-notif-progress-bar" id="bcpb-${room.id}"></div>
      </div>
      <div class="bc-notif-btns">
        <button class="bc-btn-join" onclick="window.location.href='${BRAINCLASH_URL}?join=${room.id}'">
          ⚡ JOIN BATTLE
        </button>
        <button class="bc-btn-close">✕</button>
      </div>
    `;

    // Close btn
    el.querySelector('.bc-btn-close').onclick = () => dismiss(el);
    wrap.appendChild(el);

    // Countdown 5 detik
    let t = 5;
    const timerEl = el.querySelector(`#bct-${room.id}`);
    const barEl   = el.querySelector(`#bcpb-${room.id}`);
    barEl.style.transitionDuration = '5s';
    // trigger reflow
    barEl.getBoundingClientRect();
    barEl.style.width = '0%';

    const iv = setInterval(() => {
      t--;
      if (timerEl) timerEl.textContent = t + 's';
      if (t <= 0) { clearInterval(iv); dismiss(el); }
    }, 1000);

    el._timer = iv;
  }

  function dismiss(el) {
    if (el._timer) clearInterval(el._timer);
    el.classList.add('bc-exit');
    setTimeout(() => el.remove(), 350);
  }

  // Firebase init & listen
  function initFirebase() {
    if (typeof firebase === 'undefined') return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      const db = firebase.database();

      // Listen rooms sorted by pot (prioritas pot terbesar)
      db.ref('brainclash/rooms').orderByChild('pot').on('child_added', snap => {
        const room = snap.val();
        if (!room) return;
        if (room.status !== 'waiting') return;
        if (room.playerCount >= 4) return;

        // Cek apakah bukan halaman brainclash sendiri
        if (window.location.pathname.includes('brainclash')) return;

        // Queue popup (prioritas pot besar sudah dihandle oleh orderByChild desc)
        setTimeout(() => showNotif({ id: snap.key, ...room }), 300);
      });

      // Update jika room berubah status (sudah penuh/selesai)
      db.ref('brainclash/rooms').on('child_changed', snap => {
        const room = snap.val();
        if (room && (room.status === 'playing' || room.status === 'finished')) {
          shown.add(snap.key); // jangan tampilkan lagi
        }
      });

    } catch(e) { console.warn('[BrainClash Notif]', e); }
  }

  // Tunggu Firebase SDK siap
  if (typeof firebase !== 'undefined') {
    initFirebase();
  } else {
    window.addEventListener('load', () => setTimeout(initFirebase, 1000));
  }

  // Expose untuk testing manual
  window._bcShowTestNotif = () => showNotif({
    id: 'test_' + Date.now(),
    categoryId: Math.floor(Math.random()*6),
    pot: (350 + Math.floor(Math.random()*3150)) * 1e9,
    playerCount: 1,
    creator: '0xAbCd...1234',
    creatorName: 'TestPlayer'
  });

})();
