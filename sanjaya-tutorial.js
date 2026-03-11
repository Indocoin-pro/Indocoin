/**
 * SANJAYA Tutorial System — Panduan Interaktif dengan Maskot
 * Muncul otomatis untuk pemain baru, bisa di-skip oleh pemain lama.
 */

(function(){
  'use strict';

  const STORAGE_KEY = 'sanjaya_tutorial_done';
  const STORAGE_RACE = 'sanjaya_tutorial_race_done';

  // ═══ CSS ═══
  const CSS = `
  #sj-tut-overlay {
    position:fixed;inset:0;z-index:1000;pointer-events:none;
  }
  #sj-maskot-wrap {
    position:fixed;bottom:70px;left:50%;transform:translateX(-50%);
    z-index:1001;display:none;flex-direction:column;align-items:center;
    max-width:320px;width:90%;pointer-events:all;
    animation:sjMaskotIn .4s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes sjMaskotIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
  #sj-bubble {
    background:linear-gradient(135deg,rgba(19,14,8,0.99),rgba(30,22,12,0.99));
    border:2px solid rgba(245,200,66,0.5);border-radius:18px;padding:14px 16px;
    width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.8),0 0 30px rgba(245,200,66,0.1);
    position:relative;margin-bottom:6px;
  }
  #sj-bubble::after{
    content:'';position:absolute;bottom:-10px;left:50%;transform:translateX(-50%);
    border:10px solid transparent;border-top-color:rgba(245,200,66,0.5);
    border-bottom:none;
  }
  #sj-speaker {
    font-family:'Cinzel',serif;font-size:9px;font-weight:700;
    color:rgba(245,200,66,0.8);letter-spacing:1px;margin-bottom:6px;
    display:flex;align-items:center;gap:5px;
  }
  #sj-text {
    font-family:'Crimson Text',serif;font-size:14px;color:#f0e0c0;
    line-height:1.6;margin-bottom:10px;min-height:40px;
  }
  #sj-progress {
    display:flex;gap:4px;margin-bottom:10px;
  }
  .sj-dot {
    width:6px;height:6px;border-radius:50%;background:rgba(245,200,66,0.2);
    transition:all .3s;
  }
  .sj-dot.done { background:rgba(245,200,66,0.6); }
  .sj-dot.active { background:var(--gold,#f5c842);box-shadow:0 0 6px rgba(245,200,66,0.6); }
  #sj-btns { display:flex;gap:8px; }
  .sj-btn {
    flex:1;padding:9px;border-radius:10px;font-family:'Cinzel',serif;
    font-size:9px;font-weight:700;letter-spacing:.5px;cursor:pointer;border:none;transition:all .2s;
  }
  .sj-btn-next {
    background:linear-gradient(135deg,#8b1a1a,#c0392b);color:#fde68a;
    box-shadow:0 3px 15px rgba(139,26,26,0.5);
  }
  .sj-btn-next:hover { transform:scale(1.03); }
  .sj-btn-skip {
    background:rgba(255,255,255,0.04);color:#8a7060;
    border:1px solid rgba(255,255,255,0.08);
  }
  #sj-avatar-row {
    display:flex;justify-content:center;align-items:flex-end;gap:4px;
    margin-bottom:-4px;
  }
  #sj-avatar {
    font-size:44px;display:block;
    animation:sjAvatarBob 2s ease-in-out infinite;
    filter:drop-shadow(0 4px 12px rgba(245,200,66,0.4));
  }
  @keyframes sjAvatarBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
  #sj-avatar-name {
    font-family:'Cinzel',serif;font-size:7px;font-weight:700;
    color:rgba(245,200,66,0.6);letter-spacing:1px;text-align:center;margin-top:2px;
  }

  /* HIGHLIGHT OVERLAY */
  .sj-highlight {
    position:fixed;z-index:999;pointer-events:none;
    border-radius:12px;
    box-shadow:0 0 0 9999px rgba(0,0,0,0.75), 0 0 0 3px rgba(245,200,66,0.6);
    animation:sjHighlightPulse 1.5s ease-in-out infinite;
    transition:all .4s ease;
  }
  @keyframes sjHighlightPulse{
    0%,100%{box-shadow:0 0 0 9999px rgba(0,0,0,0.75),0 0 0 3px rgba(245,200,66,0.6)}
    50%{box-shadow:0 0 0 9999px rgba(0,0,0,0.75),0 0 0 6px rgba(245,200,66,0.9),0 0 20px rgba(245,200,66,0.3)}
  }

  /* TOOLTIP POINTER */
  .sj-tooltip-arrow {
    position:fixed;z-index:1000;font-size:24px;pointer-events:none;
    animation:sjArrowBounce .6s ease-in-out infinite;
  }
  @keyframes sjArrowBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}

  #sj-btn-open {
    position:fixed;bottom:70px;right:12px;z-index:900;
    width:42px;height:42px;border-radius:50%;
    background:linear-gradient(135deg,rgba(139,26,26,0.9),rgba(192,57,43,0.9));
    border:2px solid rgba(245,200,66,0.4);
    font-size:20px;cursor:pointer;display:none;
    align-items:center;justify-content:center;
    box-shadow:0 4px 20px rgba(0,0,0,0.5);
    animation:sjOpenPulse 2.5s ease-in-out infinite;
    transition:all .2s;
  }
  @keyframes sjOpenPulse{0%,100%{box-shadow:0 4px 20px rgba(0,0,0,0.5)}50%{box-shadow:0 4px 30px rgba(245,200,66,0.3)}}
  #sj-btn-open:hover { transform:scale(1.1); }
  `;

  // ═══ TUTORIAL STEPS PER PAGE ═══
  const STEPS = {
    lobby: [
      {
        text: "Selamat datang di SINGGASANA SANJAYA! 🏰 Aku Raja Kecil, pemandu setiamu. Aku akan mengajarimu cara merebut Singgasana Raja Sanjaya!",
        highlight: null,
        emoji: "👑"
      },
      {
        text: "Pertama, hubungkan wallet kamu! Tekan tombol CONNECT di pojok kanan atas. Pastikan kamu punya INDC Token dan pakai jaringan BSC (BNB Chain).",
        highlight: "#walletBtn, .btn-w",
        emoji: "🔗"
      },
      {
        text: "Pilih HERO favoritmu di tab SHOP! Setiap hero punya kekuatan berbeda. DUKUN SAKTI gratis untuk semua. Hero langka bisa dibeli dengan INDC!",
        highlight: ".tab[data-tab='shop'], #tab-shop",
        emoji: "⚔️"
      },
      {
        text: "Atur ENTRY FEE di tab LOBBY. Minimal 200 INDC. Makin besar fee = makin besar hadiah! Total pot = fee × 4 pemain.",
        highlight: ".fee-wrap, #feeInput",
        emoji: "💰"
      },
      {
        text: "Tekan DAFTAR & SIAP! Kamu akan otomatis masuk room atau membuat room baru. Tunggu sampai 4 pemain terkumpul lalu race dimulai!",
        highlight: "#btnReady",
        emoji: "🚀"
      },
      {
        text: "Lihat peta NUSANTARA di tab PETA! Ada 4 medan: Desa → Hutan/Laut → Gunung/Rawa → Istana Sanjaya. Siapa pertama tiba — MENANG!",
        highlight: ".tab[data-tab='peta']",
        emoji: "🗺️"
      },
      {
        text: "Siap berpetualang? Kamu sudah paham dasar-dasarnya! Kalau butuh bantuan, tekan tombol 👑 di kanan bawah untuk membuka tutorial lagi. Selamat berjuang, Ksatria! ⚔️",
        highlight: null,
        emoji: "🎉"
      }
    ],

    race: [
      {
        text: "Race dimulai! Kamu berada di DESA NUSANTARA. Tujuanmu adalah SINGGASANA RAJA SANJAYA di ujung peta. Bergeraklah lebih cepat dari lawan!",
        highlight: null,
        emoji: "🏘️"
      },
      {
        text: "Tekan MAJU untuk melempar dadu (1–6). Kamu maju sesuai angka dadu. Aksi ini selalu tersedia setiap giliran!",
        highlight: "#bMove",
        emoji: "🏃"
      },
      {
        text: "Tekan SERANG untuk menyerang lawan terdekat. Ini memperlambat mereka! Ada cooldown 3 giliran setelah dipakai.",
        highlight: "#bAtk",
        emoji: "⚔️"
      },
      {
        text: "BADAI, JEBAK, dan SEMBUNYI adalah aksi spesial. Gunakan strategis! Jebakan bisa menghentikan lawan yang melewatinya.",
        highlight: "#bSkill, #bTrap, #bHide",
        emoji: "🌪️"
      },
      {
        text: "Perhatikan STAGE BAR di atas! Itu menunjukkan posisimu di peta. Semakin ke kanan semakin dekat ke Istana Sanjaya. 🏰",
        highlight: ".stage-bar, #stageBar",
        emoji: "📍"
      },
      {
        text: "Awasi HP lawan di KARTU PEMAIN bawah! Kalau HP 0, mereka terlempar dari race. Tapi kamu tidak bisa kalah — hanya melambat!",
        highlight: ".players-row",
        emoji: "❤️"
      },
      {
        text: "Perhatikan TIMER! Kalau waktu habis sebelum ada yang menang, pemain terdekat ke Istana menang. Jangan buang waktu! Selamat berlomba! 🏆",
        highlight: "#timerBox",
        emoji: "⏱️"
      }
    ]
  };

  let _steps = [];
  let _currentStep = 0;
  let _active = false;
  let _highlightEl = null;
  let _arrowEl = null;
  let _page = 'lobby';

  function injectCSS() {
    if (document.getElementById('sj-tut-css')) return;
    const style = document.createElement('style');
    style.id = 'sj-tut-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function buildUI() {
    if (document.getElementById('sj-maskot-wrap')) return;

    // Overlay
    const ov = document.createElement('div');
    ov.id = 'sj-tut-overlay';
    document.body.appendChild(ov);

    // Maskot wrap
    const wrap = document.createElement('div');
    wrap.id = 'sj-maskot-wrap';
    wrap.innerHTML = `
      <div id="sj-bubble">
        <div id="sj-speaker">👑 RAJA KECIL · PEMANDU SANJAYA</div>
        <div id="sj-text">Selamat datang!</div>
        <div id="sj-progress"></div>
        <div id="sj-btns">
          <button class="sj-btn sj-btn-skip" id="sj-btn-skip">LEWATI</button>
          <button class="sj-btn sj-btn-next" id="sj-btn-next">LANJUT ›</button>
        </div>
      </div>
      <div id="sj-avatar-row">
        <div style="text-align:center">
          <span id="sj-avatar">👑</span>
          <div id="sj-avatar-name">RAJA KECIL</div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    // Open button (ditampilkan setelah tutorial selesai)
    const openBtn = document.createElement('button');
    openBtn.id = 'sj-btn-open';
    openBtn.innerHTML = '👑';
    openBtn.title = 'Buka Tutorial';
    openBtn.onclick = () => startTutorial(_page, true);
    document.body.appendChild(openBtn);

    document.getElementById('sj-btn-next').onclick = nextStep;
    document.getElementById('sj-btn-skip').onclick = skipTutorial;
  }

  function renderProgress() {
    const el = document.getElementById('sj-progress');
    if (!el) return;
    el.innerHTML = _steps.map((_, i) =>
      `<div class="sj-dot ${i < _currentStep ? 'done' : i === _currentStep ? 'active' : ''}"></div>`
    ).join('');
  }

  function showStep(idx) {
    const step = _steps[idx];
    if (!step) return;

    const textEl = document.getElementById('sj-text');
    const avatarEl = document.getElementById('sj-avatar');
    const nextBtn = document.getElementById('sj-btn-next');

    // Fade text
    if (textEl) {
      textEl.style.opacity = '0';
      setTimeout(() => {
        textEl.textContent = step.text;
        textEl.style.transition = 'opacity .3s';
        textEl.style.opacity = '1';
      }, 150);
    }

    if (avatarEl) {
      avatarEl.textContent = step.emoji || '👑';
    }

    if (nextBtn) {
      nextBtn.textContent = idx === _steps.length - 1 ? 'MULAI! 🚀' : 'LANJUT ›';
    }

    renderProgress();
    clearHighlight();

    if (step.highlight) {
      setTimeout(() => doHighlight(step.highlight), 200);
    }

    // Sound
    if (window.SanjayaSound) {
      window.SanjayaSound.sfx.notify();
    }
  }

  function doHighlight(selector) {
    const selectors = selector.split(',').map(s => s.trim());
    let el = null;
    for (const s of selectors) {
      el = document.querySelector(s);
      if (el) break;
    }
    if (!el) return;

    clearHighlight();
    const rect = el.getBoundingClientRect();
    const pad = 6;

    _highlightEl = document.createElement('div');
    _highlightEl.className = 'sj-highlight';
    _highlightEl.style.cssText = `
      top:${rect.top - pad}px;left:${rect.left - pad}px;
      width:${rect.width + pad*2}px;height:${rect.height + pad*2}px;
    `;
    document.body.appendChild(_highlightEl);

    // Arrow pointer
    _arrowEl = document.createElement('div');
    _arrowEl.className = 'sj-tooltip-arrow';
    _arrowEl.textContent = '👆';
    _arrowEl.style.cssText = `
      top:${rect.bottom + 6}px;left:${rect.left + rect.width/2 - 12}px;
    `;
    document.body.appendChild(_arrowEl);
  }

  function clearHighlight() {
    if (_highlightEl) { _highlightEl.remove(); _highlightEl = null; }
    if (_arrowEl) { _arrowEl.remove(); _arrowEl = null; }
  }

  function nextStep() {
    if (_currentStep >= _steps.length - 1) {
      endTutorial();
      return;
    }
    _currentStep++;
    showStep(_currentStep);
    if (window.SanjayaSound) window.SanjayaSound.sfx.click();
  }

  function skipTutorial() {
    if (window.SanjayaSound) window.SanjayaSound.sfx.click();
    endTutorial();
  }

  function endTutorial() {
    clearHighlight();
    const wrap = document.getElementById('sj-maskot-wrap');
    const openBtn = document.getElementById('sj-btn-open');
    if (wrap) {
      wrap.style.animation = 'sjMaskotIn .3s reverse';
      setTimeout(() => { wrap.style.display = 'none'; }, 280);
    }
    if (openBtn) openBtn.style.display = 'flex';
    _active = false;

    // Simpan status selesai
    try {
      if (_page === 'race') localStorage.setItem(STORAGE_RACE, '1');
      else localStorage.setItem(STORAGE_KEY, '1');
    } catch(e) {}
  }

  function startTutorial(page, force=false) {
    _page = page || 'lobby';
    _steps = STEPS[_page] || STEPS.lobby;
    _currentStep = 0;
    _active = true;

    const wrap = document.getElementById('sj-maskot-wrap');
    const openBtn = document.getElementById('sj-btn-open');
    if (wrap) { wrap.style.display = 'flex'; wrap.style.animation = 'sjMaskotIn .4s cubic-bezier(.34,1.56,.64,1)'; }
    if (openBtn) openBtn.style.display = 'none';

    showStep(0);
  }

  function autoStart(page) {
    injectCSS();
    buildUI();

    const storageKey = page === 'race' ? STORAGE_RACE : STORAGE_KEY;
    let done = false;
    try { done = localStorage.getItem(storageKey) === '1'; } catch(e) {}

    if (!done) {
      // Delay sedikit biar halaman sudah render
      setTimeout(() => startTutorial(page, false), 800);
    } else {
      // Tampilkan tombol open saja
      const openBtn = document.getElementById('sj-btn-open');
      if (openBtn) openBtn.style.display = 'flex';
    }
  }

  // ═══ RESET TUTORIAL (untuk testing) ═══
  function resetTutorial() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_RACE);
    } catch(e) {}
  }

  // ═══ EXPORT ═══
  window.SanjayaTutorial = {
    autoStart,
    start: startTutorial,
    reset: resetTutorial,
    next: nextStep,
    skip: skipTutorial
  };

})();
