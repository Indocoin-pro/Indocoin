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
    bottom: 64px;
    left: 0;
    right: 0;
    z-index: 999;
    display: flex;
    justify-content: center;
    pointer-events: none;
    padding: 0 12px;
  }
  #indc-aw-inner {
    pointer-events: all;
    width: 100%;
    max-width: 480px;
  }

  /* ── TOMBOL TRIGGER ── */
  #indc-aw-trigger {
    width: 100%;
    padding: 12px 16px;
    background: linear-gradient(135deg, rgba(10,10,10,0.97), rgba(20,15,5,0.97));
    border: 1.5px solid rgba(200,146,42,0.5);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    transition: all 0.3s;
    box-shadow: 0 4px 24px rgba(0,0,0,0.6);
    backdrop-filter: blur(12px);
  }
  #indc-aw-trigger:hover {
    border-color: rgba(200,146,42,0.8);
    box-shadow: 0 4px 30px rgba(200,146,42,0.2);
  }
  #indc-aw-trigger.claimed {
    border-color: rgba(46,168,106,0.4);
    opacity: 0.6;
    cursor: default;
  }
  .aw-left { display: flex; align-items: center; gap: 10px; }
  .aw-icon { font-size: 22px; }
  .aw-info { display: flex; flex-direction: column; }
  .aw-title {
    font-family: 'Orbitron', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: #f5c842;
    letter-spacing: 1px;
  }
  .aw-sub {
    font-family: 'Share Tech Mono', monospace;
    font-size: 9px;
    color: #a89880;
    letter-spacing: 1px;
    margin-top: 1px;
  }
  .aw-badge {
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    padding: 4px 10px;
    border-radius: 4px;
    background: rgba(200,146,42,0.15);
    border: 1px solid rgba(200,146,42,0.4);
    color: #e8a830;
    letter-spacing: 1px;
    white-space: nowrap;
  }
  .aw-badge.green {
    background: rgba(46,168,106,0.12);
    border-color: rgba(46,168,106,0.3);
    color: #2ea86a;
  }
  .aw-badge.muted {
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.1);
    color: #6b5a48;
  }

  /* ── PANEL DROPDOWN ── */
  #indc-aw-panel {
    background: rgba(10,10,10,0.98);
    border: 1.5px solid rgba(200,146,42,0.3);
    border-radius: 12px;
    margin-top: 6px;
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.4s ease, opacity 0.3s ease;
    opacity: 0;
    backdrop-filter: blur(20px);
  }
  #indc-aw-panel.open {
    max-height: 600px;
    opacity: 1;
  }
  .aw-panel-inner { padding: 14px; }

  /* Steps */
  .aw-steps {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
  }
  .aw-step {
    flex: 1;
    padding: 6px 4px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    text-align: center;
    font-family: 'Share Tech Mono', monospace;
    font-size: 8px;
    color: #6b5a48;
    letter-spacing: 0.5px;
    transition: all 0.3s;
  }
  .aw-step.active {
    border-color: rgba(200,146,42,0.4);
    color: #e8a830;
    background: rgba(200,146,42,0.06);
  }
  .aw-step.done {
    border-color: rgba(46,168,106,0.4);
    color: #2ea86a;
    background: rgba(46,168,106,0.06);
  }

  /* Quiz */
  .aw-quiz-cat {
    font-family: 'Share Tech Mono', monospace;
    font-size: 8px;
    color: #c8922a;
    letter-spacing: 1.5px;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  .aw-quiz-q {
    font-family: 'Rajdhani', sans-serif;
    font-size: 14px;
    font-weight: 600;
    color: #f5f0e8;
    line-height: 1.4;
    margin-bottom: 10px;
  }
  .aw-opts { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .aw-opt {
    padding: 10px 12px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 7px;
    cursor: pointer;
    font-family: 'Rajdhani', sans-serif;
    font-size: 13px;
    color: #a89880;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .aw-opt:hover { background: rgba(200,146,42,0.08); border-color: rgba(200,146,42,0.3); color: #f5f0e8; }
  .aw-opt.correct { background: rgba(46,168,106,0.12); border-color: rgba(46,168,106,0.4); color: #2ea86a; }
  .aw-opt.wrong { background: rgba(201,64,64,0.1); border-color: rgba(201,64,64,0.3); color: #c94040; }
  .aw-opt.disabled { pointer-events: none; }
  .aw-opt-lbl { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #6b5a48; width: 14px; flex-shrink: 0; }
  .aw-result {
    font-family: 'Share Tech Mono', monospace;
    font-size: 9px;
    padding: 8px 10px;
    border-radius: 6px;
    margin-bottom: 10px;
    line-height: 1.5;
    display: none;
  }
  .aw-result.ok { background: rgba(46,168,106,0.1); border: 1px solid rgba(46,168,106,0.3); color: #2ea86a; }
  .aw-result.fail { background: rgba(201,64,64,0.08); border: 1px solid rgba(201,64,64,0.25); color: #c94040; }
  .aw-divider { height: 1px; background: rgba(200,146,42,0.1); margin: 10px 0; }

  /* Upload area */
  .aw-upload {
    border: 1.5px dashed rgba(255,255,255,0.15);
    border-radius: 8px;
    padding: 10px;
    text-align: center;
    cursor: pointer;
    margin-bottom: 8px;
    transition: all 0.3s;
  }
  .aw-upload:hover { border-color: rgba(200,146,42,0.4); }
  .aw-upload p { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #6b5a48; }
  .aw-upload img { max-width: 100%; border-radius: 6px; margin-top: 6px; display: none; max-height: 80px; object-fit: cover; }

  /* Buttons */
  .aw-btn {
    width: 100%;
    padding: 11px;
    border: none;
    border-radius: 8px;
    font-family: 'Orbitron', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all 0.3s;
    margin-bottom: 6px;
  }
  .aw-btn-claim {
    background: linear-gradient(135deg, #5a3800, #e8a830);
    color: #080808;
  }
  .aw-btn-claim:hover { box-shadow: 0 4px 20px rgba(250,204,21,0.4); transform: translateY(-1px); }
  .aw-btn-claim:disabled { background: rgba(255,255,255,0.07); color: #6b5a48; transform: none; box-shadow: none; cursor: not-allowed; }
  .aw-btn-verify {
    background: rgba(74,158,255,0.1);
    border: 1px solid rgba(74,158,255,0.35);
    color: #4a9eff;
  }
  .aw-btn-verify:hover { background: rgba(74,158,255,0.18); }
  .aw-btn-verify:disabled { opacity: 0.4; cursor: not-allowed; }
  .aw-btn-skip {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    color: #6b5a48;
    font-size: 9px;
  }
  .aw-btn-skip:hover { color: #a89880; }

  /* Status */
  .aw-status {
    font-family: 'Share Tech Mono', monospace;
    font-size: 9px;
    text-align: center;
    min-height: 14px;
    margin-top: 4px;
    transition: all 0.3s;
  }
  .aw-ok { color: #2ea86a; }
  .aw-err { color: #c94040; }
  .aw-info { color: #a89880; }

  /* Claimed state */
  .aw-claimed {
    text-align: center;
    padding: 16px 10px;
  }
  .aw-claimed-icon { font-size: 28px; margin-bottom: 6px; }
  .aw-claimed-title {
    font-family: 'Orbitron', sans-serif;
    font-size: 12px;
    color: #2ea86a;
    letter-spacing: 2px;
    margin-bottom: 4px;
  }
  .aw-claimed-sub {
    font-family: 'Share Tech Mono', monospace;
    font-size: 9px;
    color: #6b5a48;
    line-height: 1.6;
  }
  .aw-countdown {
    font-family: 'Orbitron', sans-serif;
    font-size: 14px;
    color: #c8922a;
    margin-top: 8px;
  }

  /* Sosmed task link */
  .aw-task-link {
    display: block;
    padding: 9px;
    background: rgba(200,146,42,0.07);
    border: 1px solid rgba(200,146,42,0.25);
    border-radius: 7px;
    color: #e8a830;
    font-family: 'Share Tech Mono', monospace;
    font-size: 9px;
    text-align: center;
    text-decoration: none;
    letter-spacing: 1px;
    margin-bottom: 8px;
    transition: all 0.2s;
  }
  .aw-task-link:hover { background: rgba(200,146,42,0.14); }

  @keyframes aw-fadein { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  .aw-fadein { animation: aw-fadein 0.3s ease both; }
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
    if (panelOpen) {
      panel.classList.add('open');
      // Coba baca wallet terbaru sebelum render
      if (!walletAddr) {
        const saved = localStorage.getItem('indocoin_wallet');
        if (saved && window.ethereum) {
          initWidget(saved).then(() => {
            if (!walletAddr) renderConnectPrompt();
          });
        } else {
          renderConnectPrompt();
        }
      } else {
        renderWidget();
      }
    } else {
      panel.classList.remove('open');
    }
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
      setContent(`<div style="text-align:center;padding:14px;font-family:'Share Tech Mono',monospace;font-size:9px;color:#c94040;">
        ⚠️ airdrop-questions.js belum dimuat.<br>Pastikan script dimuat sebelum airdrop-widget.js
      </div>`);
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
      const qs   = getAirdropQuestion(walletAddr, PAGE_ID, claimLevel);
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
    const result = checkAnswer(soalId, idx, claimLevel);
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
    // Strategi: baca eth_accounts dari MetaMask langsung
    // eth_accounts tidak minta popup — hanya return akun yang sudah diizinkan
    // Ini paling reliable karena tidak tergantung localStorage atau variable halaman

    let attempts = 0;
    const MAX    = 12; // retry sampai ~6 detik

    async function tryConnect() {
      attempts++;

      let addr = null;

      // Prioritas 1: MetaMask eth_accounts (selalu akurat)
      if (window.ethereum) {
        const accs = await window.ethereum
          .request({ method: 'eth_accounts' })
          .catch(() => []);
        if (accs && accs.length > 0) addr = accs[0];
      }

      // Prioritas 2: localStorage indocoin_wallet (backup)
      if (!addr) {
        addr = localStorage.getItem('indocoin_wallet');
      }

      if (addr) {
        // Simpan/update localStorage agar sesi berikutnya lebih cepat
        localStorage.setItem('indocoin_wallet', addr.toLowerCase());
        await initWidget(addr);
        return;
      }

      // Belum connect — coba lagi
      if (attempts < MAX) {
        setTimeout(tryConnect, 500);
      }
    }

    // Mulai setelah sedikit delay agar MetaMask inject dulu
    setTimeout(tryConnect, 600);
  }

  // ── START ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { buildWidget(); setTimeout(autoInit, 800); });
  } else {
    buildWidget();
    setTimeout(autoInit, 800);
  }

})();
