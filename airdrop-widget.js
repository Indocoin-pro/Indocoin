/**
 * INDOCOIN AIRDROP WIDGET v2.0
 * Alur: Timer 30 detik → 2 Pertanyaan (Edukasi + Platform) → Claim 1 INDC
 * Tanpa screenshot. Reset jam 00:00.
 * Contract: 0xA5eBf687F6a67E34D4FFde8c460cAE46834e3623
 */
(function() {
  'use strict';

  const TIMER_SECONDS = 30;

  const PAGE_MAP = {
    'presale.html':1,'indc-staking.html':2,'earn.html':3,
    'autocompoundstaking.html':4,'boostlevelstaking.html':5,
    'dynamiclevelstaking.html':6,'flexiyieldstaking.html':7,
    'garudaforcemissionstaking.html':8,'growth-lock-staking.html':9,
    'lockeddiamondstaking.html':10,
    'referralpowerstaking.html':11,'trade.html':12,'wave-trade.html':13,
    'delta-trade.html':14,'three-trade.html':15,'blitz-trade.html':16,
    'clash-trade.html':17,'cycle-trade.html':18,'phantom-box-trade.html':19,
    'shadow-copy-trade.html':20,'signal-trade.html':21,'undian.html':22,
    'dokumen.html':23,'permainan.html':24,'brainclash.html':25,
    'sanjaya.html':26,'indowar.html':27,'stairway-to-heaven.html':28,
    'referral.html':29,'dashboard.html':30,'assets.html':31,
    'community.html':32,'token-lock-tracker.html':33,'paid-ads.html':34,
    'guruku.html':35,'chart.html':36,'pointvaultstaking.html':37,
  };

  function getPageId() {
    const script = document.currentScript;
    if(script && script.dataset.pageId) return parseInt(script.dataset.pageId);
    const fn = window.location.pathname.split('/').pop()||'';
    return PAGE_MAP[fn]||99;
  }
  const PAGE_ID = getPageId();

  const CSS = `
  #indc-aw{position:fixed;bottom:62px;left:0;right:0;z-index:999;display:flex;justify-content:center;pointer-events:none;padding:0 10px;}
  #indc-aw-inner{pointer-events:all;width:100%;max-width:480px;}
  #indc-aw-trigger{background:#fff;border:1.5px solid #fcd34d;border-radius:10px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.12);transition:all 0.2s;}
  #indc-aw-trigger:hover{box-shadow:0 4px 18px rgba(0,0,0,0.16),0 0 0 2px rgba(217,119,6,0.2);}
  .aw-left{display:flex;align-items:center;gap:8px;}
  .aw-title{font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:#92400e;letter-spacing:1px;}
  .aw-sub{font-family:'Share Tech Mono',monospace;font-size:8px;color:#78716c;letter-spacing:0.5px;margin-top:1px;}
  .aw-badge{font-family:'Orbitron',sans-serif;font-size:9px;font-weight:700;padding:4px 10px;border-radius:5px;background:linear-gradient(135deg,#92400e,#d97706);color:#fff;letter-spacing:0.5px;white-space:nowrap;}
  .aw-badge.green{background:linear-gradient(135deg,#065f46,#059669);color:#fff;}
  #indc-aw-panel{background:#fff;border:1.5px solid #e7e5e4;border-radius:10px;margin-top:4px;overflow:hidden;max-height:0;transition:max-height 0.35s ease,opacity 0.25s ease;opacity:0;box-shadow:0 4px 20px rgba(0,0,0,0.1);}
  #indc-aw-panel.open{max-height:500px;opacity:1;}
  .aw-inner{padding:14px;max-height:420px;overflow-y:auto;}

  /* TIMER */
  .aw-timer{text-align:center;padding:14px 10px;}
  .aw-timer-lbl{font-family:'Share Tech Mono',monospace;font-size:9px;color:#78716c;letter-spacing:1.5px;margin-bottom:10px;}
  .aw-ring{position:relative;width:72px;height:72px;margin:0 auto 10px;}
  .aw-ring svg{transform:rotate(-90deg);}
  .aw-track{fill:none;stroke:#fef3c7;stroke-width:4;}
  .aw-fill{fill:none;stroke:#d97706;stroke-width:4;stroke-linecap:round;transition:stroke-dashoffset 1s linear;}
  .aw-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Orbitron',sans-serif;font-size:22px;font-weight:700;color:#92400e;}
  .aw-hint{font-family:'Share Tech Mono',monospace;font-size:8px;color:#a8a29e;line-height:1.6;}

  /* STEPS */
  .aw-steps{display:flex;gap:4px;margin-bottom:12px;}
  .aw-step{flex:1;padding:5px 4px;border-radius:5px;text-align:center;font-family:'Share Tech Mono',monospace;font-size:8px;letter-spacing:0.5px;background:#f5f5f4;border:1px solid #e7e5e4;color:#a8a29e;transition:all 0.2s;}
  .aw-step.active{background:#fef3c7;border-color:#fcd34d;color:#92400e;font-weight:700;}
  .aw-step.done{background:#d1fae5;border-color:#6ee7b7;color:#065f46;font-weight:700;}

  /* QUIZ */
  .aw-qcat{font-family:'Share Tech Mono',monospace;font-size:8px;color:#92400e;letter-spacing:1.5px;margin-bottom:5px;margin-top:10px;}
  .aw-qq{font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:600;color:#1c1917;line-height:1.4;margin-bottom:8px;}
  .aw-opts{display:flex;flex-direction:column;gap:5px;margin-bottom:6px;}
  .aw-opt{padding:9px 11px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:7px;cursor:pointer;font-family:'Rajdhani',sans-serif;font-size:13px;color:#44403c;transition:all 0.2s;display:flex;align-items:center;gap:8px;}
  .aw-opt:hover{background:#fffbeb;border-color:#fcd34d;color:#1c1917;}
  .aw-opt.correct{background:#d1fae5;border-color:#6ee7b7;color:#065f46;}
  .aw-opt.wrong{background:#fee2e2;border-color:#fca5a5;color:#dc2626;}
  .aw-opt.disabled{pointer-events:none;}
  .aw-opt-lbl{font-family:'Share Tech Mono',monospace;font-size:9px;color:#a8a29e;width:14px;flex-shrink:0;}
  .aw-result{margin-top:6px;padding:7px 9px;border-radius:6px;font-family:'Share Tech Mono',monospace;font-size:9px;line-height:1.5;display:none;}
  .aw-result.ok{background:#d1fae5;border:1px solid #6ee7b7;color:#065f46;}
  .aw-result.fail{background:#fee2e2;border:1px solid #fca5a5;color:#dc2626;}
  .aw-divider{height:1px;background:#f5f5f4;margin:10px 0;}

  /* CLAIM */
  .aw-btn-claim{width:100%;border:none;border-radius:8px;font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;cursor:pointer;transition:all 0.2s;padding:12px;background:linear-gradient(135deg,#92400e,#d97706);color:#fff;margin-top:10px;}
  .aw-btn-claim:hover{box-shadow:0 4px 20px rgba(217,119,6,0.35);transform:translateY(-1px);}
  .aw-btn-claim:disabled{background:#e7e5e4;color:#a8a29e;cursor:not-allowed;transform:none;box-shadow:none;}
  .aw-status{font-family:'Share Tech Mono',monospace;font-size:9px;text-align:center;min-height:12px;margin-top:6px;}
  .aw-ok{color:#065f46;} .aw-err{color:#dc2626;} .aw-info{color:#a8a29e;}

  /* CLAIMED */
  .aw-claimed{text-align:center;padding:16px 10px;}
  .aw-claimed-icon{font-size:28px;margin-bottom:8px;}
  .aw-claimed-title{font-family:'Orbitron',sans-serif;font-size:11px;color:#065f46;letter-spacing:2px;margin-bottom:4px;}
  .aw-claimed-sub{font-family:'Share Tech Mono',monospace;font-size:9px;color:#78716c;line-height:1.6;}
  .aw-cd{font-family:'Orbitron',sans-serif;font-size:13px;color:#d97706;margin-top:8px;}
  @keyframes aw-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
  .aw-fadein{animation:aw-in 0.25s ease both;}
  `;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // ── STATE ─────────────────────────────────────────────────
  let walletAddr=null, panelOpen=false, isClaimed=false;
  let timerDone=false, eduDone=false, platDone=false;
  let timerInterval=null, cdTimer=null;
  let currentEdu=null, currentPlat=null;
  let timerLeft=TIMER_SECONDS;

  // ── LOAD QUESTIONS ────────────────────────────────────────
  function ensureQ(cb) {
    if(window.AIRDROP_QUESTIONS){cb();return;}
    const base=(function(){
      const ss=document.querySelectorAll('script[src]');
      for(let s of ss) if(s.src&&s.src.includes('airdrop-widget')) return s.src.replace('airdrop-widget.js','');
      return '';
    })();
    const s=document.createElement('script');
    s.src=base+'airdrop-questions.js';
    s.onload=cb;
    document.head.appendChild(s);
  }

  // ── BUILD WIDGET ──────────────────────────────────────────
  function build() {
    const w=document.createElement('div');
    w.id='indc-aw';
    w.innerHTML=`
    <div id="indc-aw-inner">
      <div id="indc-aw-trigger" onclick="window._awToggle()">
        <div class="aw-left">
          <span style="font-size:18px;">🪂</span>
          <div><div class="aw-title">AIRDROP GRATIS</div><div class="aw-sub" id="aw-sub">Klaim 1 INDC · Baca 30 detik</div></div>
        </div>
        <span class="aw-badge" id="aw-badge">1 INDC</span>
      </div>
      <div id="indc-aw-panel">
        <div class="aw-inner" id="aw-content">
          <div style="text-align:center;padding:16px;font-family:'Share Tech Mono',monospace;font-size:10px;color:#a89880;">⏳ Memuat...</div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(w);
  }

  window._awToggle = function() {
    panelOpen=!panelOpen;
    const panel=document.getElementById('indc-aw-panel');
    if(panelOpen){
      panel.classList.add('open');
      ensureQ(()=>{ if(!walletAddr) renderConnect(); else renderMain(); });
    } else {
      panel.classList.remove('open');
      if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
    }
  };

  function renderConnect() {
    setContent(`<div style="text-align:center;padding:14px 0;font-family:'Share Tech Mono',monospace;font-size:9px;color:#a89880;line-height:1.7;">⏳ Menunggu wallet connect...<br>Connect wallet di halaman ini terlebih dahulu.</div>`);
    let n=0;
    const iv=setInterval(async()=>{
      n++; if(walletAddr||n>30){clearInterval(iv);return;}
      let addr=localStorage.getItem('indocoin_wallet');
      if(!addr&&window.ethereum){try{const a=await window.ethereum.request({method:'eth_accounts'});if(a&&a.length)addr=a[0];}catch(e){}}
      if(!addr)addr=window.userAddr||window.userAddress||null;
      if(addr){clearInterval(iv);walletAddr=addr.toLowerCase();localStorage.setItem('indocoin_wallet',walletAddr);if(panelOpen)renderMain();}
    },800);
  }

  function renderMain() {
    if(!walletAddr){renderConnect();return;}
    if(isClaimedToday()){renderClaimed();return;}
    if(!currentEdu||!currentPlat) pickQuestions();
    if(!timerDone) renderTimer();
    else renderQuiz();
  }

  // ── PICK QUESTIONS ────────────────────────────────────────
  function pickQuestions() {
    if(!window.AIRDROP_QUESTIONS||!window.getAirdropQuestion) return;
    const qs = window.getAirdropQuestion(walletAddr||'anon', PAGE_ID, 1);
    currentEdu  = qs.edukasi;
    currentPlat = qs.platform;
  }

  // ── TIMER ─────────────────────────────────────────────────
  function renderTimer() {
    timerLeft=TIMER_SECONDS;
    const C=2*Math.PI*28;
    setContent(`
      <div class="aw-timer aw-fadein">
        <div class="aw-timer-lbl">BACA HALAMAN INI · ${TIMER_SECONDS} DETIK</div>
        <div class="aw-ring">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle class="aw-track" cx="36" cy="36" r="28"/>
            <circle class="aw-fill" id="aw-fill" cx="36" cy="36" r="28" stroke-dasharray="${C}" stroke-dashoffset="0"/>
          </svg>
          <div class="aw-num" id="aw-num">${TIMER_SECONDS}</div>
        </div>
        <div class="aw-hint">Tetap di halaman ini selama 30 detik<br>lalu jawab 2 pertanyaan untuk klaim 1 INDC</div>
      </div>`);
    if(timerInterval)clearInterval(timerInterval);
    timerInterval=setInterval(()=>{
      timerLeft--;
      const numEl=document.getElementById('aw-num');
      const fillEl=document.getElementById('aw-fill');
      if(numEl)numEl.textContent=timerLeft;
      if(fillEl)fillEl.style.strokeDashoffset=C*(timerLeft/TIMER_SECONDS);
      if(timerLeft<=0){
        clearInterval(timerInterval);timerInterval=null;
        timerDone=true;renderQuiz();
      }
    },1000);
  }

  // ── QUIZ ──────────────────────────────────────────────────
  function renderQuiz() {
    if(!currentEdu||!currentPlat){renderClaimed();return;}
    const L=['A','B','C','D'];
    const eduOpts=currentEdu.p.map((o,i)=>`
      <div class="aw-opt" id="aw-e-${i}" onclick="window._awAns('edu',${currentEdu.id},${i})">
        <span class="aw-opt-lbl">${L[i]}</span>${o}
      </div>`).join('');
    const platOpts=currentPlat.p.map((o,i)=>`
      <div class="aw-opt" id="aw-p-${i}" onclick="window._awAns('plat',${currentPlat.id},${i})">
        <span class="aw-opt-lbl">${L[i]}</span>${o}
      </div>`).join('');

    setContent(`
      <div class="aw-fadein">
        <div class="aw-steps">
          <div class="aw-step done">⏱ TIMER ✅</div>
          <div class="aw-step ${eduDone?'done':'active'}" id="aw-st-edu">📚 EDUKASI${eduDone?' ✅':''}</div>
          <div class="aw-step ${platDone?'done':'active'}" id="aw-st-plat">🏛 PLATFORM${platDone?' ✅':''}</div>
        </div>
        <div class="aw-qcat">📚 SOAL EDUKASI</div>
        <div class="aw-qq">${currentEdu.q}</div>
        <div class="aw-opts" id="aw-edu-opts">${eduOpts}</div>
        <div class="aw-result" id="aw-edu-res"></div>
        <div class="aw-divider"></div>
        <div class="aw-qcat">🏛 SOAL PLATFORM</div>
        <div class="aw-qq">${currentPlat.q}</div>
        <div class="aw-opts" id="aw-plat-opts">${platOpts}</div>
        <div class="aw-result" id="aw-plat-res"></div>
        <button class="aw-btn-claim" id="aw-btn-claim" disabled onclick="window._awClaim()">KLAIM 1 INDC</button>
        <div class="aw-status" id="aw-claim-st"></div>
      </div>`);
  }

  window._awAns = function(type, soalId, idx) {
    const pfx = type==='edu'?'aw-edu':'aw-plat';
    const opts = document.getElementById(pfx+'-opts');
    if(!opts)return;
    opts.querySelectorAll('.aw-opt').forEach(o=>o.classList.add('disabled'));
    const all=[...window.AIRDROP_QUESTIONS.level1,...window.AIRDROP_QUESTIONS.level2];
    const soal=all.find(s=>s.id===soalId);
    if(!soal)return;
    const benar=idx===soal.j;
    const clicked=document.getElementById(`aw-${type==='edu'?'e':'p'}-${idx}`);
    if(clicked)clicked.classList.add(benar?'correct':'wrong');
    if(!benar){
      const correctEl=document.getElementById(`aw-${type==='edu'?'e':'p'}-${soal.j}`);
      if(correctEl)correctEl.classList.add('correct');
    }
    const resEl=document.getElementById(pfx+'-res');
    if(resEl){resEl.style.display='block';resEl.className='aw-result '+(benar?'ok':'fail');resEl.textContent=(benar?'✅ Benar! ':'❌ Salah. ')+soal.e;}
    if(type==='edu'){eduDone=benar;const st=document.getElementById('aw-st-edu');if(st){st.className='aw-step '+(benar?'done':'active');if(benar)st.textContent='📚 EDUKASI ✅';}}
    if(type==='plat'){platDone=benar;const st=document.getElementById('aw-st-plat');if(st){st.className='aw-step '+(benar?'done':'active');if(benar)st.textContent='🏛 PLATFORM ✅';}}
    const btn=document.getElementById('aw-btn-claim');
    if(btn)btn.disabled=!(eduDone&&platDone);
  };

  window._awClaim = async function() {
    if(!walletAddr||!eduDone||!platDone)return;
    const btn=document.getElementById('aw-btn-claim');
    if(btn){btn.disabled=true;btn.textContent='⏳ MENYIMPAN...';}
    setAwStatus('⏳ Menyimpan ke wallet...','info');
    try{
      const wk=walletAddr.toLowerCase();
      const pending=JSON.parse(localStorage.getItem('indc_pending_claims_'+wk)||'[]');
      if(!pending.includes(PAGE_ID)){pending.push(PAGE_ID);localStorage.setItem('indc_pending_claims_'+wk,JSON.stringify(pending));}
      localStorage.setItem('indc_claimed_'+wk+'_page_'+PAGE_ID+'_'+todayKey(),'1');
      isClaimed=true;
      setAwStatus('✅ +1 INDC masuk ke wallet airdrop!','ok');
      setTimeout(()=>{renderClaimed();setTimeout(()=>hideWidget(),2500);},1000);
    }catch(e){
      if(btn){btn.disabled=false;btn.textContent='KLAIM 1 INDC';}
      setAwStatus('❌ '+(e.message||'Gagal').slice(0,50),'err');
    }
  };

  function renderClaimed() {
    setContent(`
      <div class="aw-claimed aw-fadein">
        <div class="aw-claimed-icon">✅</div>
        <div class="aw-claimed-title">SUDAH DIKLAIM</div>
        <div class="aw-claimed-sub">+1 INDC masuk ke wallet airdrop.<br>Reset besok pukul 00:00.</div>
        <div class="aw-cd" id="aw-cd">--:--:--</div>
        <a href="airdrop.html" style="display:block;margin-top:12px;font-family:'Share Tech Mono',monospace;font-size:9px;color:#e8a830;text-align:center;text-decoration:none;letter-spacing:1px;">LIHAT SEMUA HALAMAN AIRDROP →</a>
      </div>`);
    const badge=document.getElementById('aw-badge');
    const sub=document.getElementById('aw-sub');
    if(badge){badge.textContent='✅ CLAIMED';badge.className='aw-badge green';}
    if(sub)sub.textContent='Sudah klaim hari ini · Reset 00:00';
    if(cdTimer)clearInterval(cdTimer);
    function tick(){
      const now=new Date(),next=new Date();next.setHours(24,0,0,0);
      const d=next-now;const el=document.getElementById('aw-cd');
      if(!el){clearInterval(cdTimer);return;}
      const h=String(Math.floor(d/3600000)).padStart(2,'0');
      const m=String(Math.floor((d%3600000)/60000)).padStart(2,'0');
      const s=String(Math.floor((d%60000)/1000)).padStart(2,'0');
      el.textContent=h+':'+m+':'+s;
    }
    tick();cdTimer=setInterval(tick,1000);
  }

  function hideWidget(){
    const w=document.getElementById('indc-aw');
    if(!w)return;
    w.style.transition='opacity 0.5s ease,transform 0.5s ease';
    w.style.opacity='0';w.style.transform='translateY(10px)';
    setTimeout(()=>{w.style.display='none';},500);
  }

  function isClaimedToday(){
    if(!walletAddr)return false;
    return localStorage.getItem('indc_claimed_'+walletAddr.toLowerCase()+'_page_'+PAGE_ID+'_'+todayKey())==='1';
  }

  function setContent(html){const el=document.getElementById('aw-content');if(el)el.innerHTML=html;}
  function setAwStatus(msg,type){const el=document.getElementById('aw-claim-st');if(el){el.textContent=msg;el.className='aw-status aw-'+type;}}
  function todayKey(){const d=new Date();return `${d.getFullYear()}${d.getMonth()}${d.getDate()}`;}

  // ── AUTO INIT ─────────────────────────────────────────────
  async function autoInit(){
    let n=0;
    async function try_(){
      n++;
      let addr=null;
      if(window.ethereum){try{const a=await window.ethereum.request({method:'eth_accounts'});if(a&&a.length)addr=a[0];}catch(e){}}
      if(!addr)addr=localStorage.getItem('indocoin_wallet');
      if(!addr)addr=window.userAddr||window.userAddress||null;
      if(addr){
        walletAddr=addr.toLowerCase();
        localStorage.setItem('indocoin_wallet',walletAddr);
        if(isClaimedToday()){hideWidget();return;}
        // Widget HANYA aktif jika datang dari airdrop.html (?airdrop=1)
        const params = new URLSearchParams(window.location.search);
        if(params.get('airdrop') !== '1'){hideWidget();return;}
      }
      if(n<12)setTimeout(try_,500);
    }
    setTimeout(try_,600);
  }

  // Cek parameter ?airdrop=1 dulu sebelum build widget
  const _params = new URLSearchParams(window.location.search);
  if(_params.get('airdrop') !== '1') {
    // Bukan dari airdrop.html - jangan tampilkan widget
    // Tapi tetap init untuk cek status
    setTimeout(autoInit, 800);
    return;
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{build();setTimeout(autoInit,800);});
  }else{build();setTimeout(autoInit,800);}

})();
