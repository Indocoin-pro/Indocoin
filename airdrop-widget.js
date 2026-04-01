/**
 * INDOCOIN AIRDROP WIDGET
 * File  : airdrop-widget.js
 * Inject ke semua halaman platform INDOCOIN
 * Contract: 0x3532c81dD148b46de0b04Aad9476C9093Ea19835 (BSC Mainnet)
 *
 * CARA PAKAI:
 * Tambahkan di setiap halaman sebelum </body>:
 *   <script src="airdrop-widget.js" data-page-id="X"></script>
 * Ganti X dengan nomor pageId unik per halaman (lihat PAGE_MAP di bawah)
 */

(function() {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────
  const AIRDROP_CONTRACT = '0x3532c81dD148b46de0b04Aad9476C9093Ea19835';
  const BSC_CHAIN_ID     = 56;
  const DECIMALS         = 9;

  // Map nama file → pageId unik
  const PAGE_MAP = {
    'presale.html':                  1,
    'indc-staking.html':             2,
    'earn.html':                     3,
    'autocompoundstaking.html':      4,
    'boostlevelstaking.html':        5,
    'dynamiclevelstaking.html':      6,
    'flexiyieldstaking.html':        7,
    'garudaforcemissionstaking.html':8,
    'growth-lock-staking.html':      9,
    'lockeddiamondstaking.html':     10,
    'pointvaultstaking.html':        11,
    'referralpowerstaking.html':     12,
    'trade.html':                    13,
    'wave-trade.html':               14,
    'delta-trade.html':              15,
    'three-trade.html':              16,
    'blitz-trade.html':              17,
    'clash-trade.html':              18,
    'cycle-trade.html':              19,
    'phantom-box-trade.html':        20,
    'shadow-copy-trade.html':        21,
    'oracle-trade.html':             22,
    'signal-trade.html':             23,
    'league-trade.html':             24,
    'time-vault-trade.html':         25,
    'undian.html':                   26,
    'dokumen.html':                  27,
    'permainan.html':                28,
    'brainclash.html':               29,
    'sanjaya.html':                  30,
    'indowar.html':                  31,
    'stairway-to-heaven.html':       32,
    'referral.html':                 33,
    'dashboard.html':                34,
    'assets.html':                   35,
    'leaderboard.html':              36,
    'profile.html':                  37,
    'swap.html':                     38,
    'community.html':                39,
  };

  // ABI minimum untuk widget
  const WIDGET_ABI = [
    "function claim(uint256 pageId) external",
    "function hasClaimedPage(address user, uint256 pageId) external view returns (bool)",
    "function getUserInfo(address user) external view returns (uint256 balance, uint256 totalEarned, uint256 totalWithdrawn, uint256 streakCount, uint256 refBonusEarned, uint256 todayWithdrawnAmt, bool canWithdraw)",
  ];

  // Deteksi pageId dari script tag atau dari nama file
  function getPageId() {
    const script = document.currentScript;
    if (script && script.dataset.pageId) return parseInt(script.dataset.pageId);
    const filename = window.location.pathname.split('/').pop() || '';
    return PAGE_MAP[filename] || 99;
  }

  const PAGE_ID = getPageId();

  // ── CSS WIDGET ────────────────────────────────────────────
  const CSS = `
  #indc-airdrop-widget {
    position: fixed;
    bottom: 62px;
    left: 0; right: 0;
    z-index: 999;
    display: flex;
    justify-content: center;
    pointer-events: none;
    padding: 0 10px;
  }
  #indc-aw-inner { pointer-events: all; width: 100%; max-width: 480px; }

  /* ── TRIGGER ── */
  #indc-aw-trigger {
    background: #ffffff;
    border: 1.5px solid rgba(200,146,42,0.5);
    border-radius: 10px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    box-shadow: 0 2px 16px rgba(0,0,0,0.4);
    transition: all 0.2s;
  }
  #indc-aw-trigger:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 2px rgba(200,146,42,0.3); }
  #indc-aw-trigger.claimed { opacity: 0.7; }
  .aw-left { display: flex; align-items: center; gap: 8px; }
  .aw-icon { font-size: 18px; line-height: 1; }
  .aw-info {}
  .aw-title { font-family:'Orbitron',sans-serif; font-size:10px; font-weight:700; color:#92400e; letter-spacing:1px; line-height:1; }
  .aw-sub   { font-family:'Share Tech Mono',monospace; font-size:8px; color:#78716c; letter-spacing:0.5px; margin-top:1px; }
  .aw-badge { font-family:'Orbitron',sans-serif; font-size:9px; font-weight:700; padding:4px 10px; border-radius:5px; background:linear-gradient(135deg,#92400e,#d97706); color:#fff; letter-spacing:0.5px; white-space:nowrap; }
  .aw-badge.green { background:linear-gradient(135deg,#065f46,#059669); }
  .aw-badge.muted { background:#e7e5e4; color:#a8a29e; }

  /* ── PANEL ── */
  #indc-aw-panel {
    background: #ffffff;
    border: 1.5px solid rgba(200,146,42,0.3);
    border-radius: 10px;
    margin-top: 4px;
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.35s ease, opacity 0.25s ease;
    opacity: 0;
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
  }
  #indc-aw-panel.open { max-height: 520px; opacity: 1; }
  .aw-panel-inner { padding: 12px; max-height: 400px; overflow-y: auto; }

  /* Steps */
  .aw-steps { display:flex; gap:4px; margin-bottom:10px; }
  .aw-step { flex:1; padding:5px 4px; border-radius:5px; text-align:center; font-family:'Share Tech Mono',monospace; font-size:8px; letter-spacing:0.5px; background:#f5f5f4; border:1px solid #e7e5e4; color:#a8a29e; transition:all 0.2s; }
  .aw-step.active { background:#fef3c7; border-color:#d97706; color:#92400e; font-weight:700; }
  .aw-step.done   { background:#d1fae5; border-color:#059669; color:#065f46; font-weight:700; }

  /* Task Sosmed */
  .aw-quiz-cat { font-family:'Share Tech Mono',monospace; font-size:8px; color:#92400e; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:5px; }
  .aw-quiz-q   { font-family:'Rajdhani',sans-serif; font-size:14px; font-weight:600; color:#1c1917; line-height:1.4; margin-bottom:8px; }
  .aw-opts { display:flex; flex-direction:column; gap:5px; margin-bottom:6px; }
  .aw-opt {
    padding: 9px 11px;
    background: #ffffff;
    border: 1.5px solid #e7e5e4;
    border-radius: 6px;
    cursor: pointer;
    font-family: 'Rajdhani',sans-serif;
    font-size: 13px;
    color: #44403c;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .aw-opt:hover   { background:#fffbeb; border-color:#d97706; color:#1c1917; }
  .aw-opt.correct { background:#d1fae5; border-color:#059669; color:#065f46; }
  .aw-opt.wrong   { background:#fee2e2; border-color:#dc2626; color:#991b1b; }
  .aw-opt.disabled { pointer-events:none; }
  .aw-opt-lbl { font-family:'Share Tech Mono',monospace; font-size:9px; color:#a8a29e; width:14px; flex-shrink:0; font-weight:700; }
  .aw-result { margin-top:7px; padding:8px 10px; border-radius:6px; font-family:'Share Tech Mono',monospace; font-size:9px; line-height:1.5; display:none; }
  .aw-result.ok   { background:#d1fae5; border:1px solid #6ee7b7; color:#065f46; }
  .aw-result.fail { background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; }
  .aw-divider { height:1px; background:#f5f5f4; margin:8px 0; }

  /* Task area */
  .aw-task-box { background:#fafaf9; border:1px solid #e7e5e4; border-radius:8px; padding:10px; margin-bottom:8px; }
  .aw-task-link { display:block; padding:7px 10px; background:#fef3c7; border:1px solid #d97706; border-radius:6px; color:#92400e; font-family:'Share Tech Mono',monospace; font-size:9px; text-align:center; text-decoration:none; letter-spacing:0.5px; margin-bottom:7px; transition:all 0.2s; }
  .aw-task-link:hover { background:#fde68a; }

  /* Upload */
  .aw-upload { border:1.5px dashed #d6d3d1; border-radius:7px; padding:10px; text-align:center; cursor:pointer; transition:all 0.2s; margin-bottom:7px; background:#fafaf9; }
  .aw-upload:hover { border-color:#d97706; background:#fffbeb; }
  .aw-upload p { font-family:'Share Tech Mono',monospace; font-size:9px; color:#a8a29e; }
  .aw-upload img { max-width:100%; border-radius:5px; margin-top:6px; display:none; max-height:70px; object-fit:cover; }

  /* Buttons */
  .aw-btn { width:100%; border:none; border-radius:6px; font-family:'Orbitron',sans-serif; font-size:9px; font-weight:700; letter-spacing:0.5px; cursor:pointer; transition:all 0.2s; margin-bottom:5px; padding:8px; }
  .aw-btn-claim { padding:12px; font-size:12px; letter-spacing:2px; background:linear-gradient(135deg,#92400e,#d97706); color:#fff; box-shadow:0 2px 12px rgba(217,119,6,0.3); }
  .aw-btn-claim:hover { box-shadow:0 4px 20px rgba(217,119,6,0.5); transform:translateY(-1px); }
  .aw-btn-claim:disabled { background:#e7e5e4; color:#a8a29e; box-shadow:none; transform:none; cursor:not-allowed; }
  .aw-btn-verify { background:#dbeafe; border:1px solid #3b82f6; color:#1d4ed8; }
  .aw-btn-verify:hover { background:#bfdbfe; }
  .aw-btn-verify:disabled { opacity:0.4; cursor:not-allowed; }
  .aw-btn-skip { background:transparent; border:1px solid #e7e5e4; color:#a8a29e; font-size:9px; font-family:'Share Tech Mono',monospace; }
  .aw-btn-skip:hover { border-color:#d6d3d1; color:#78716c; }

  /* Status & misc */
  .aw-status { font-family:'Share Tech Mono',monospace; font-size:9px; text-align:center; min-height:12px; margin-top:4px; }
  .aw-ok   { color:#059669; }
  .aw-err  { color:#dc2626; }
  .aw-info { color:#a8a29e; }
  .aw-claim-note { font-family:'Share Tech Mono',monospace; font-size:9px; color:#a8a29e; text-align:center; margin-top:4px; }

  /* Claimed state */
  .aw-claimed { text-align:center; padding:14px 10px; }
  .aw-claimed-icon { font-size:26px; margin-bottom:6px; }
  .aw-claimed-title { font-family:'Orbitron',sans-serif; font-size:11px; color:#059669; letter-spacing:2px; margin-bottom:4px; }
  .aw-claimed-sub { font-family:'Share Tech Mono',monospace; font-size:9px; color:#a8a29e; line-height:1.6; }
  .aw-countdown { font-family:'Orbitron',sans-serif; font-size:14px; color:#d97706; margin-top:6px; }

  /* Unlock */
  .aw-unlock { text-align:center; padding:12px 8px; }
  .aw-unlock-title { font-family:'Orbitron',sans-serif; font-size:11px; color:#1d4ed8; letter-spacing:2px; margin:6px 0; }
  .aw-unlock-desc { font-family:'Share Tech Mono',monospace; font-size:9px; color:#78716c; line-height:1.6; margin-bottom:12px; }

  @keyframes aw-in { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
  .aw-fadein { animation:aw-in 0.25s ease both; }
  `;

  // ── INJECT CSS ────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // ── STATE ─────────────────────────────────────────────────
  let provider2, signer2, contract2, walletAddr;
  let panelOpen   = false;
  let skipLeft    = 2;
  let sosmedDone  = false;
  let eduDone     = false;
  let platDone    = false;
  let imgData     = null;
  let currentTask = null;
  let currentEdu  = null;
  let currentPlat = null;
  let claimLevel  = 1;
  let isClaimed   = false;
  let countdownTimer = null;

  // ── SOSMED POOL ───────────────────────────────────────────
  const SOSMED = [
    { id:'yt_sub',    pl:'📺 YouTube',       desc:'Subscribe channel @indocoin_defi_web3',          link:'https://youtube.com/@indocoin_defi_web3' },
    { id:'yt_like',   pl:'📺 YouTube',       desc:'Like video terbaru INDOCOIN di YouTube',          link:'https://youtube.com/@indocoin_defi_web3' },
    { id:'ig_follow', pl:'📸 Instagram',     desc:'Follow @indocoin_indc di Instagram',             link:'https://www.instagram.com/indocoin_indc' },
    { id:'ig_like',   pl:'📸 Instagram',     desc:'Like postingan terbaru @indocoin_indc',          link:'https://www.instagram.com/indocoin_indc' },
    { id:'tg_join',   pl:'✈️ Telegram',      desc:'Gabung group Telegram resmi INDOCOIN',           link:'https://t.me/+CzjgvwApDscwMGM1' },
    { id:'fb_like',   pl:'👍 Facebook',      desc:'Like halaman Facebook resmi INDOCOIN',           link:'https://www.facebook.com/share/1NaUZBDiyS/' },
    { id:'x_follow',  pl:'✖️ X / Twitter',   desc:'Follow @Indocoin_INDC di X (Twitter)',           link:'https://x.com/Indocoin_INDC' },
    { id:'td_follow', pl:'🧵 Threads',       desc:'Follow @indocoin_indc di Threads',               link:'https://www.threads.com/@indocoin_indc' },
    { id:'wa_share',  pl:'💬 WhatsApp',      desc:'Share ajakan bergabung INDOCOIN ke WA Group',    link:null },
    { id:'sosmed_any',pl:'📣 Share Bebas',   desc:'Share konten INDOCOIN di platform manapun',      link:null },
    { id:'ig_story',  pl:'📸 Instagram',     desc:'Share postingan INDOCOIN ke IG Story',           link:'https://www.instagram.com/indocoin_indc' },
    { id:'fb_share',  pl:'👍 Facebook',      desc:'Share postingan INDOCOIN ke timeline Facebook',  link:'https://www.facebook.com/share/1NaUZBDiyS/' },
    { id:'x_rt',      pl:'✖️ X / Twitter',   desc:'Retweet tweet terbaru @Indocoin_INDC',           link:'https://x.com/Indocoin_INDC' },
    { id:'yt_komen',  pl:'📺 YouTube',       desc:'Komen kata "INDOCOIN" di video YouTube',         link:'https://youtube.com/@indocoin_defi_web3' },
    { id:'qr_share',  pl:'📱 Share QR',      desc:'Screenshot QR wallet kamu dan share ke teman',   link:null },
  ];

  // ── LOAD QUESTIONS DINAMIS ───────────────────────────────
  function ensureQuestions(callback) {
    if (window.AIRDROP_QUESTIONS) { callback(); return; }

    // Sudah pernah dicoba load — tunggu saja
    if (window._awQLoading) {
      const wait = setInterval(() => {
        if (window.AIRDROP_QUESTIONS) { clearInterval(wait); callback(); }
      }, 300);
      return;
    }
    window._awQLoading = true;

    const s = document.createElement('script');
    // Gunakan path absolut dari root domain — paling reliable
    const origin = window.location.origin;
    s.src = origin + '/airdrop-questions.js';
    s.onload = () => {
      window._awQLoading = false;
      if (window.AIRDROP_QUESTIONS && callback) callback();
    };
    s.onerror = () => {
      window._awQLoading = false;
      // Fallback: coba path relatif
      const s2 = document.createElement('script');
      s2.src = 'airdrop-questions.js';
      s2.onload = () => { window._awQLoading = false; if (window.AIRDROP_QUESTIONS && callback) callback(); };
      document.head.appendChild(s2);
    };
    document.head.appendChild(s);
  }

  // ── BUILD HTML ────────────────────────────────────────────
  function buildWidget() {
    const wrap = document.createElement('div');
    wrap.id = 'indc-airdrop-widget';
    wrap.innerHTML = `
    <div id="indc-aw-inner">
      <div id="indc-aw-trigger" onclick="window._awToggle()">
        <div class="aw-left">
          <span class="aw-icon">🪂</span>
          <div class="aw-info">
            <span class="aw-title">AIRDROP GRATIS</span>
            <span class="aw-sub" id="aw-sub-txt">Claim 1 INDC di halaman ini</span>
          </div>
        </div>
        <span class="aw-badge" id="aw-main-badge">CLAIM</span>
      </div>
      <div id="indc-aw-panel">
        <div class="aw-panel-inner" id="aw-panel-content">
          <div style="text-align:center;padding:16px;font-family:'Share Tech Mono',monospace;font-size:10px;color:#6b5a48;">
            ⏳ Memuat...
          </div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(wrap);
  }

  window._awToggle = function() {
    panelOpen = !panelOpen;
    const panel = document.getElementById('indc-aw-panel');
    if (!panelOpen) { panel.classList.remove('open'); return; }

    panel.classList.add('open');

    // Tampilkan loading sementara
    setContent('<div style="text-align:center;padding:16px;font-family:monospace;font-size:9px;color:#a89880;">⏳ Memuat...</div>');

    // Pastikan wallet ada
    async function getWallet() {
      if (walletAddr) return walletAddr;
      // Coba eth_accounts
      if (window.ethereum) {
        const accs = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
        if (accs && accs.length > 0) return accs[0];
      }
      // Coba localStorage
      return localStorage.getItem('indocoin_wallet');
    }

    getWallet().then(async (addr) => {
      if (addr && !walletAddr) {
        localStorage.setItem('indocoin_wallet', addr.toLowerCase());
        await initWidget(addr);
      }
      // Load questions lalu render
      ensureQuestions(() => {
        if (panelOpen) renderWidget();
      });
    });
  };

  // ── RENDER: CONNECT PROMPT ────────────────────────────────
  // Tidak tampilkan prompt besar — cukup info kecil
  // Semua halaman sudah handle connect wallet sendiri
  function renderConnectPrompt() {
    setContent(`
      <div style="text-align:center;padding:12px 0;">
        <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#6b5a48;line-height:1.7;">
          ⏳ Menunggu wallet connect...<br>
          Connect wallet di halaman ini terlebih dahulu.
        </div>
      </div>
    `);
    // Retry deteksi wallet setiap 800ms
    let retryCount = 0;
    const retryInterval = setInterval(async () => {
      retryCount++;
      if (walletAddr || retryCount > 10) { clearInterval(retryInterval); return; }
      let addr = null;
      if (window.ethereum) {
        const acc = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
        if (acc && acc.length > 0) addr = acc[0];
      }
      if (!addr) addr = localStorage.getItem('indocoin_wallet');
      if (addr) {
        clearInterval(retryInterval);
        localStorage.setItem('indocoin_wallet', addr.toLowerCase());
        await initWidget(addr);
        if (panelOpen) renderWidget();
      }
    }, 800);
  }

  // ── INIT WIDGET ───────────────────────────────────────────
  async function initWidget(address) {
    try {
      provider2 = new ethers.providers.Web3Provider(window.ethereum);
      const net = await provider2.getNetwork();
      if (net.chainId !== BSC_CHAIN_ID) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
          provider2 = new ethers.providers.Web3Provider(window.ethereum);
        } catch(e) { return; }
      }
      signer2    = provider2.getSigner();
      contract2  = new ethers.Contract(AIRDROP_CONTRACT, WIDGET_ABI, signer2);
      walletAddr = address;

      // Simpan wallet
      localStorage.setItem('indocoin_wallet', address.toLowerCase());

      await checkClaimed();
    } catch(e) { console.error('[AW]', e); }
  }

  async function checkClaimed() {
    if (!contract2 || !walletAddr) return;
    try {
      isClaimed = await contract2.hasClaimedPage(walletAddr, PAGE_ID);

      // Hitung level
      const wk = walletAddr.toLowerCase();
      const cp = parseInt(localStorage.getItem(`indc_claimed_pages_${wk}`) || '0');
      claimLevel = cp >= 15 ? 2 : 1;

      // Update trigger badge
      updateTrigger();
      if (panelOpen) renderWidget();
    } catch(e) {}
  }

  function updateTrigger() {
    const badge = document.getElementById('aw-main-badge');
    const sub   = document.getElementById('aw-sub-txt');
    if (!badge) return;

    if (isClaimed) {
      badge.textContent = '✅ CLAIMED';
      badge.className   = 'aw-badge green';
      sub.textContent   = 'Sudah diklaim hari ini — kembali besok';
      document.getElementById('indc-aw-trigger').classList.add('claimed');
    } else {
      badge.textContent = '🎁 1 INDC';
      badge.className   = 'aw-badge';
      sub.textContent   = `Claim 1 INDC di halaman ini (Page #${PAGE_ID})`;
    }
  }

  // ── RENDER WIDGET ─────────────────────────────────────────
  function renderWidget() {
    if (!walletAddr) { renderConnectPrompt(); return; }
    if (isClaimed)   { renderClaimed(); return; }

    const wk = walletAddr.toLowerCase();

    // Cek unlock untuk halaman 16+
    if (claimLevel === 2) {
      const unlocked = localStorage.getItem(`indc_unlocked_${wk}`) === 'true';
      if (!unlocked) { renderUnlock(); return; }
    }

    renderTaskPanel();
  }

  // ── RENDER: CLAIMED ───────────────────────────────────────
  function renderClaimed() {
    setContent(`
      <div class="aw-claimed aw-fadein">
        <div class="aw-claimed-icon">✅</div>
        <div class="aw-claimed-title">SUDAH DIKLAIM</div>
        <div class="aw-claimed-sub">Kamu sudah klaim 1 INDC hari ini.<br>Reset besok pukul 00:00.</div>
        <div class="aw-countdown" id="aw-cd">--:--:--</div>
        <a href="airdrop.html" style="display:block;margin-top:10px;font-family:'Share Tech Mono',monospace;font-size:9px;color:#c8922a;text-align:center;text-decoration:none;">
          📊 Lihat Semua Halaman Airdrop →
        </a>
      </div>
    `);
    startWidgetCountdown();
  }

  function startWidgetCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    function tick() {
      const now  = new Date();
      const next = new Date(); next.setHours(24,0,0,0);
      const d    = next - now;
      const el   = document.getElementById('aw-cd');
      if (!el) { clearInterval(countdownTimer); return; }
      const h = String(Math.floor(d/3600000)).padStart(2,'0');
      const m = String(Math.floor((d%3600000)/60000)).padStart(2,'0');
      const s = String(Math.floor((d%60000)/1000)).padStart(2,'0');
      el.textContent = h+':'+m+':'+s;
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // ── RENDER: UNLOCK ────────────────────────────────────────
  function renderUnlock() {
    setContent(`
      <div class="aw-fadein">
        <div style="text-align:center;margin-bottom:12px;">
          <div style="font-size:24px;">🔒</div>
          <div style="font-family:'Orbitron',sans-serif;font-size:11px;color:#4a9eff;letter-spacing:2px;margin-top:6px;">
            UNLOCK DIPERLUKAN
          </div>
          <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#6b5a48;line-height:1.6;margin-top:6px;">
            Upload screenshot share INDOCOIN di sosmed<br>untuk unlock akses halaman 16–39.
          </div>
        </div>
        <div class="aw-upload" onclick="document.getElementById('aw-unlock-file').click()">
          <p>📸 Tap untuk upload screenshot</p>
          <img id="aw-unlock-prev" alt="">
        </div>
        <input type="file" id="aw-unlock-file" accept="image/*" style="display:none"
          onchange="window._awUnlockUpload(event)">
        <button class="aw-btn aw-btn-verify" id="aw-btn-unlock" disabled
          onclick="window._awSubmitUnlock()">
          🔓 SUBMIT BUKTI UNLOCK
        </button>
        <div class="aw-status" id="aw-unlock-status"></div>
      </div>
    `);
  }

  window._awUnlockUpload = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => {
      imgData = ev.target.result;
      const prev = document.getElementById('aw-unlock-prev');
      if (prev) { prev.src = imgData; prev.style.display = 'block'; }
      const btn = document.getElementById('aw-btn-unlock');
      if (btn) btn.disabled = false;
    };
    r.readAsDataURL(file);
  };

  window._awSubmitUnlock = function() {
    if (!imgData || imgData.length < 5000) {
      setStatus('aw-unlock-status', '❌ Screenshot tidak valid', 'err');
      return;
    }
    setStatus('aw-unlock-status', '⏳ Memverifikasi...', 'info');
    setTimeout(() => {
      const wk = walletAddr.toLowerCase();
      localStorage.setItem(`indc_unlocked_${wk}`, 'true');
      setStatus('aw-unlock-status', '✅ Unlock berhasil!', 'ok');
      imgData = null;
      setTimeout(() => renderTaskPanel(), 1200);
    }, 1200);
  };

  // ── RENDER: TASK PANEL ────────────────────────────────────
  function renderTaskPanel() {
    if (!window.AIRDROP_QUESTIONS) {
      // Coba load lagi secara dinamis
      setContent(`<div style="text-align:center;padding:14px;font-family:'Share Tech Mono',monospace;font-size:9px;color:#a89880;">
        ⏳ Memuat bank soal...
      </div>`);
      ensureQuestions(() => {
        if (window.AIRDROP_QUESTIONS) renderTaskPanel();
      });
      return;
    }

    const wk = walletAddr.toLowerCase();
    const sosmedAllDone   = localStorage.getItem(`indc_sosmed_all_${wk}`) === 'true';
    const sosmedTodayDone = localStorage.getItem(`indc_sosmed_today_${wk}_${todayKey()}`) === 'true';
    const skipSosmed      = sosmedAllDone || sosmedTodayDone;

    if (!skipSosmed && !sosmedDone) {
      pickSosmedTask();
    } else {
      sosmedDone = true;
    }

    if (!currentEdu || !currentPlat) {
      const qs   = window.getAirdropQuestion(walletAddr, PAGE_ID, claimLevel);
      currentEdu  = qs.edukasi;
      currentPlat = qs.platform;
    }

    buildTaskHTML(skipSosmed || sosmedDone);
  }

  function pickSosmedTask() {
    if (!walletAddr) return;
    const wk        = walletAddr.toLowerCase();
    const doneTasks = JSON.parse(localStorage.getItem(`indc_sosmed_done_${wk}`) || '[]');
    const avail     = SOSMED.filter(t => !doneTasks.includes(t.id));
    if (avail.length === 0) {
      localStorage.setItem(`indc_sosmed_all_${wk}`, 'true');
      sosmedDone = true;
      return;
    }
    currentTask = avail[Math.floor(Math.random() * avail.length)];
  }

  function buildTaskHTML(hideSosmed) {
    const labels = ['A','B','C','D'];
    const eduOpts  = currentEdu?.p.map((o,i) =>
      `<div class="aw-opt" onclick="window._awAnswer('edu',${currentEdu.id},${i})" id="aw-edu-opt-${i}">
        <span class="aw-opt-lbl">${labels[i]}</span>${o}
       </div>`).join('') || '';
    const platOpts = currentPlat?.p.map((o,i) =>
      `<div class="aw-opt" onclick="window._awAnswer('plat',${currentPlat.id},${i})" id="aw-plat-opt-${i}">
        <span class="aw-opt-lbl">${labels[i]}</span>${o}
       </div>`).join('') || '';

    const sosmedHTML = hideSosmed ? '' : `
      <div class="aw-quiz-cat">📱 TUGAS SOSMED</div>
      <div class="aw-quiz-q">${currentTask?.pl || ''}: ${currentTask?.desc || ''}</div>
      ${currentTask?.link ? `<a href="${currentTask.link}" target="_blank" class="aw-task-link">🔗 BUKA HALAMAN</a>` : ''}
      <div class="aw-upload" onclick="document.getElementById('aw-sosmed-file').click()">
        <p id="aw-upload-hint">📸 Upload screenshot bukti</p>
        <img id="aw-sosmed-prev" alt="">
      </div>
      <input type="file" id="aw-sosmed-file" accept="image/*" style="display:none"
        onchange="window._awSosmedUpload(event)">
      <button class="aw-btn aw-btn-verify" id="aw-btn-verify" disabled
        onclick="window._awVerifySosmed()">✅ VERIFIKASI BUKTI</button>
      <button class="aw-btn aw-btn-skip" onclick="window._awSkip()">
        Ganti task (sisa: <span id="aw-skip-n">${skipLeft}</span>x)
      </button>
      <div class="aw-status" id="aw-sosmed-status"></div>
      <div class="aw-divider"></div>`;

    const steps = hideSosmed
      ? `<div class="aw-steps">
          <div class="aw-step done">1 ✅</div>
          <div class="aw-step ${eduDone?'done':'active'}" id="aw-step-edu">2${eduDone?' ✅':''}</div>
          <div class="aw-step ${platDone?'done':'active'}" id="aw-step-plat">3${platDone?' ✅':''}</div>
         </div>`
      : `<div class="aw-steps">
          <div class="aw-step ${sosmedDone?'done':'active'}" id="aw-step-sosmed">1${sosmedDone?' ✅':''}</div>
          <div class="aw-step ${eduDone?'done':'active'}" id="aw-step-edu">2${eduDone?' ✅':''}</div>
          <div class="aw-step ${platDone?'done':'active'}" id="aw-step-plat">3${platDone?' ✅':''}</div>
         </div>`;

    setContent(`
      <div class="aw-fadein">
        ${steps}
        ${sosmedHTML}
        <div class="aw-quiz-cat">📚 SOAL EDUKASI</div>
        <div class="aw-quiz-q">${currentEdu?.q || '...'}</div>
        <div class="aw-opts" id="aw-edu-opts">${eduOpts}</div>
        <div class="aw-result" id="aw-edu-result"></div>
        <div class="aw-divider"></div>
        <div class="aw-quiz-cat">🏛️ SOAL PLATFORM</div>
        <div class="aw-quiz-q">${currentPlat?.q || '...'}</div>
        <div class="aw-opts" id="aw-plat-opts">${platOpts}</div>
        <div class="aw-result" id="aw-plat-result"></div>
        <div style="margin-top:12px;">
          <button class="aw-btn aw-btn-claim" id="aw-btn-claim" disabled
            onclick="window._awClaim()">🪂 CLAIM 1 INDC</button>
          <div class="aw-status" id="aw-claim-status"></div>
        </div>
      </div>
    `);

    updateClaimBtn();
  }

  // ── SOSMED UPLOAD & VERIFY ────────────────────────────────
  window._awSosmedUpload = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => {
      imgData = ev.target.result;
      const prev = document.getElementById('aw-sosmed-prev');
      if (prev) { prev.src = imgData; prev.style.display = 'block'; }
      const hint = document.getElementById('aw-upload-hint');
      if (hint) hint.textContent = '✅ Screenshot siap diverifikasi';
      const btn = document.getElementById('aw-btn-verify');
      if (btn) btn.disabled = false;
    };
    r.readAsDataURL(file);
  };

  window._awVerifySosmed = function() {
    if (!imgData || imgData.length < 5000) {
      setStatus('aw-sosmed-status', '❌ Screenshot tidak valid', 'err');
      return;
    }
    setStatus('aw-sosmed-status', '⏳ Memverifikasi...', 'info');
    setTimeout(() => {
      const wk     = walletAddr.toLowerCase();
      const h      = simpleHash(imgData);
      const hashes = JSON.parse(localStorage.getItem(`indc_img_hashes_${wk}`) || '[]');
      if (hashes.includes(h)) {
        setStatus('aw-sosmed-status', '❌ Screenshot sudah pernah digunakan', 'err');
        return;
      }
      hashes.push(h);
      localStorage.setItem(`indc_img_hashes_${wk}`, JSON.stringify(hashes));

      const done = JSON.parse(localStorage.getItem(`indc_sosmed_done_${wk}`) || '[]');
      if (currentTask && !done.includes(currentTask.id)) done.push(currentTask.id);
      localStorage.setItem(`indc_sosmed_done_${wk}`, JSON.stringify(done));
      localStorage.setItem(`indc_sosmed_today_${wk}_${todayKey()}`, 'true');
      if (done.length >= SOSMED.length) localStorage.setItem(`indc_sosmed_all_${wk}`, 'true');

      sosmedDone = true;
      setStatus('aw-sosmed-status', '✅ Task sosmed berhasil!', 'ok');
      updateStepBadge('aw-step-sosmed', true);
      imgData = null;
      updateClaimBtn();
    }, 1000);
  };

  window._awSkip = function() {
    if (skipLeft <= 0) {
      setStatus('aw-sosmed-status', '⚠️ Batas skip habis', 'err');
      return;
    }
    skipLeft--;
    imgData = null;
    pickSosmedTask();
    buildTaskHTML(false);
  };

  // ── ANSWER QUIZ ───────────────────────────────────────────
  window._awAnswer = function(type, soalId, idx) {
    const result = window.checkAnswer(soalId, idx, claimLevel);
    const pfx    = type === 'edu' ? 'aw-edu' : 'aw-plat';
    const opts   = document.getElementById(pfx + '-opts');
    if (!opts) return;

    opts.querySelectorAll('.aw-opt').forEach(o => o.classList.add('disabled'));
    const clickedOpt = document.getElementById(`${pfx.replace('-opts','')}-opt-${idx}`);
    if (clickedOpt) clickedOpt.classList.add(result.benar ? 'correct' : 'wrong');

    if (!result.benar) {
      const pool = [...window.AIRDROP_QUESTIONS.level1, ...window.AIRDROP_QUESTIONS.level2];
      const soal = pool.find(s => s.id === soalId);
      if (soal) {
        const correctOpt = document.getElementById(`${pfx.replace('-opts','')}-opt-${soal.j}`);
        if (correctOpt) correctOpt.classList.add('correct');
      }
    }

    const resEl = document.getElementById(pfx + '-result');
    if (resEl) {
      resEl.style.display = 'block';
      resEl.className     = 'aw-result ' + (result.benar ? 'ok' : 'fail');
      resEl.textContent   = (result.benar ? '✅ Benar! ' : '❌ Salah. ') + result.penjelasan;
    }

    if (type === 'edu')  { eduDone  = result.benar; updateStepBadge('aw-step-edu',  result.benar); }
    if (type === 'plat') { platDone = result.benar; updateStepBadge('aw-step-plat', result.benar); }

    updateClaimBtn();
  };

  // ── CLAIM ─────────────────────────────────────────────────
  window._awClaim = async function() {
    if (!contract2 || !walletAddr) return;
    const btn = document.getElementById('aw-btn-claim');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ MEMPROSES...'; }
    setStatus('aw-claim-status', '⏳ Mengirim transaksi ke BSC...', 'info');

    try {
      const tx = await contract2.claim(PAGE_ID);
      setStatus('aw-claim-status', '⏳ Menunggu konfirmasi...', 'info');
      await tx.wait();

      // Update pages count
      const wk = walletAddr.toLowerCase();
      const cp = parseInt(localStorage.getItem(`indc_claimed_pages_${wk}`) || '0');
      localStorage.setItem(`indc_claimed_pages_${wk}`, cp + 1);

      isClaimed = true;
      setStatus('aw-claim-status', '✅ +1 INDC berhasil diklaim!', 'ok');
      updateTrigger();

      // Reset state untuk sesi berikutnya
      eduDone = false; platDone = false; sosmedDone = false;

      setTimeout(() => renderClaimed(), 1500);
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = '🪂 CLAIM 1 INDC'; }
      const msg = e.reason || e.message || 'Transaksi gagal';
      setStatus('aw-claim-status', '❌ ' + msg.slice(0,50), 'err');
    }
  };

  // ── HELPERS ───────────────────────────────────────────────
  function updateClaimBtn() {
    const btn  = document.getElementById('aw-btn-claim');
    if (!btn) return;
    const wk = walletAddr ? walletAddr.toLowerCase() : '';
    const sosOk = sosmedDone
      || localStorage.getItem(`indc_sosmed_all_${wk}`) === 'true'
      || localStorage.getItem(`indc_sosmed_today_${wk}_${todayKey()}`) === 'true';
    btn.disabled = !(sosOk && eduDone && platDone);
  }

  function updateStepBadge(id, done) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'aw-step ' + (done ? 'done' : 'active');
    if (done) el.textContent = el.textContent.replace(/\s*✅?$/, '') + ' ✅';
  }

  function setContent(html) {
    const el = document.getElementById('aw-panel-content');
    if (el) el.innerHTML = html;
  }

  function setStatus(id, msg, type) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.className = 'aw-status aw-' + type; }
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}${d.getMonth()}${d.getDate()}`;
  }

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < Math.min(str.length, 500); i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return h.toString(16);
  }

  // ── AUTO INIT ─────────────────────────────────────────────
  // Baca wallet dari localStorage indocoin_wallet atau langsung dari MetaMask
  // Retry sampai 10x dengan interval 800ms agar tidak miss timing
  async function autoInit() {
    // Hook MetaMask events — deteksi kapanpun wallet connect
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', async (accs) => {
        if (accs && accs.length > 0 && !walletAddr) {
          localStorage.setItem('indocoin_wallet', accs[0].toLowerCase());
          await initWidget(accs[0]);
          if (panelOpen) renderWidget();
        }
      });
      window.ethereum.on('connect', async () => {
        if (walletAddr) return;
        const accs = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
        if (accs && accs.length > 0) {
          localStorage.setItem('indocoin_wallet', accs[0].toLowerCase());
          await initWidget(accs[0]);
          if (panelOpen) renderWidget();
        }
      });
    }

    // Polling agresif: cek setiap 800ms sampai 15 detik
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      if (walletAddr || attempts > 19) { clearInterval(timer); return; }

      let addr = null;

      // Cara 1: MetaMask eth_accounts
      if (window.ethereum) {
        const accs = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
        if (accs && accs.length > 0) addr = accs[0];
      }

      // Cara 2: localStorage
      if (!addr) addr = localStorage.getItem('indocoin_wallet');

      // Cara 3: variable global halaman (berbeda tiap halaman)
      if (!addr) {
        addr = window.userAddr || window.userAddress ||
               window.currentAddr || window.connectedAddr || null;
      }

      if (addr) {
        clearInterval(timer);
        localStorage.setItem('indocoin_wallet', addr.toLowerCase());
        await initWidget(addr);
        if (panelOpen) renderWidget();
      }
    }, 800);
  }

  // ── EXPOSE API untuk halaman ─────────────────────────────
  // Halaman bisa panggil window._awSetWallet(addr) setelah connect
  window._awSetWallet = async function(addr) {
    if (!addr || walletAddr) return;
    localStorage.setItem('indocoin_wallet', addr.toLowerCase());
    await initWidget(addr);
    if (panelOpen) renderWidget();
    updateTrigger();
  };

  // ── START ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { buildWidget(); setTimeout(autoInit, 800); });
  } else {
    buildWidget();
    setTimeout(autoInit, 800);
  }

})();
