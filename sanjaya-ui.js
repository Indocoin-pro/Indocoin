/**
 * SANJAYA UI Extras — Sound Control Button + integrasi ke semua halaman
 * Pasang di akhir <body> setelah sanjaya-sound.js dan sanjaya-tutorial.js
 */
(function(){
  'use strict';

  const CSS = `
  #sj-sound-btn {
    position:fixed;top:10px;left:12px;z-index:200;
    width:36px;height:36px;border-radius:50%;
    background:rgba(5,3,2,0.92);backdrop-filter:blur(10px);
    border:1px solid rgba(245,200,66,0.3);
    font-size:16px;cursor:pointer;
    display:flex;align-items:center;justify-content:center;
    transition:all .2s;box-shadow:0 2px 12px rgba(0,0,0,0.5);
  }
  #sj-sound-btn:hover { border-color:rgba(245,200,66,0.6);transform:scale(1.08); }
  #sj-sound-btn.muted { opacity:.5; }

  #sj-vol-panel {
    position:fixed;top:52px;left:12px;z-index:200;
    background:rgba(10,7,5,0.97);backdrop-filter:blur(16px);
    border:1px solid rgba(245,200,66,0.2);border-radius:12px;
    padding:10px 12px;width:160px;
    display:none;flex-direction:column;gap:7px;
    box-shadow:0 8px 30px rgba(0,0,0,0.7);
  }
  #sj-vol-panel.show { display:flex; }
  .sj-vol-row { display:flex;flex-direction:column;gap:3px; }
  .sj-vol-lbl {
    font-family:'Share Tech Mono',monospace;font-size:7px;
    color:rgba(245,200,66,0.6);letter-spacing:1px;
  }
  .sj-vol-slider {
    width:100%;height:4px;border-radius:2px;
    background:rgba(245,200,66,0.15);
    accent-color:#f5c842;cursor:pointer;
  }
  .sj-vol-close {
    font-family:'Cinzel',serif;font-size:7px;color:rgba(255,255,255,0.3);
    text-align:center;cursor:pointer;margin-top:2px;
    border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;
  }
  .sj-vol-close:hover { color:rgba(245,200,66,0.6); }
  `;

  function injectCSS() {
    if (document.getElementById('sj-ui-css')) return;
    const s = document.createElement('style');
    s.id = 'sj-ui-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function buildSoundBtn() {
    if (document.getElementById('sj-sound-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'sj-sound-btn';
    btn.title = 'Sound On/Off';
    btn.innerHTML = '🔊';
    btn.onclick = togglePanel;
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'sj-vol-panel';
    panel.innerHTML = `
      <div class="sj-vol-row">
        <div class="sj-vol-lbl">🎵 MUSIK</div>
        <input class="sj-vol-slider" type="range" min="0" max="100" value="35" id="sj-music-vol">
      </div>
      <div class="sj-vol-row">
        <div class="sj-vol-lbl">🔔 EFEK SUARA</div>
        <input class="sj-vol-slider" type="range" min="0" max="100" value="60" id="sj-sfx-vol">
      </div>
      <div class="sj-vol-close" onclick="closeSoundPanel()">✕ TUTUP</div>
    `;
    document.body.appendChild(panel);

    document.getElementById('sj-music-vol').addEventListener('input', e => {
      if (window.SanjayaSound) window.SanjayaSound.setMusicVol(e.target.value/100);
    });
    document.getElementById('sj-sfx-vol').addEventListener('input', e => {
      if (window.SanjayaSound) window.SanjayaSound.setSfxVol(e.target.value/100);
    });
  }

  function togglePanel() {
    const panel = document.getElementById('sj-vol-panel');
    if (!panel) return;
    const isShown = panel.classList.contains('show');
    if (isShown) {
      panel.classList.remove('show');
    } else {
      // Init sound on first interaction
      if (window.SanjayaSound) {
        window.SanjayaSound.init();
        if (!window.SanjayaSound.currentBgm()) {
          const page = window._sanjayaPage || 'lobby';
          const bgm = page === 'race' ? 'race' : page === 'result' ? 'victory' : 'lobby';
          window.SanjayaSound.playBgm(bgm);
        }
      }
      panel.classList.add('show');
    }
  }

  window.closeSoundPanel = function() {
    const panel = document.getElementById('sj-vol-panel');
    if (panel) panel.classList.remove('show');
  };

  window.toggleSoundMute = function() {
    if (!window.SanjayaSound) return;
    const muted = window.SanjayaSound.toggleMute();
    const btn = document.getElementById('sj-sound-btn');
    if (btn) {
      btn.innerHTML = muted ? '🔇' : '🔊';
      btn.classList.toggle('muted', muted);
    }
  };

  // Tutup panel kalau klik di luar
  document.addEventListener('click', e => {
    const panel = document.getElementById('sj-vol-panel');
    const btn   = document.getElementById('sj-sound-btn');
    if (panel && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.remove('show');
    }
  });

  function init(page) {
    injectCSS();
    buildSoundBtn();
    window._sanjayaPage = page;

    // Auto start BGM on first user interaction
    let started = false;
    function startBgm() {
      if (started || !window.SanjayaSound) return;
      started = true;
      window.SanjayaSound.init();
      const bgm = page === 'race' ? 'race' : page === 'result' ? 'victory' : 'lobby';
      window.SanjayaSound.playBgm(bgm);
      document.removeEventListener('click', startBgm);
      document.removeEventListener('touchstart', startBgm);
      document.removeEventListener('keydown', startBgm);
    }
    document.addEventListener('click', startBgm, {once:false});
    document.addEventListener('touchstart', startBgm, {once:false});
    document.addEventListener('keydown', startBgm, {once:false});
  }

  window.SanjayaUI = { init };
})();
