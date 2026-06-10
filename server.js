// ═══════════════════════════════════════════════════════════════════ 
//  INDOCOIN — Server dengan Local File Read
//  Elara baca PDF/HTML dari folder lokal VPS
//  File baru di-deploy via GitHub Actions → otomatis terbaca
// ═══════════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const https     = require('https');
const http      = require('http');
const fs        = require('fs');

// Load .env file jika ada
try {
  const envFile = fs.readFileSync('/root/indocoin/.env', 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch(e) {}

const PORT = process.env.PORT || 443;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DOCS_PATH = '/root/indocoin/docs'; // Folder lokal PDF & HTML
const CACHE_TTL = 60 * 60 * 1000; // 1 jam (ms)

// ─── SSL ─────────────────────────────────────────────────────────────
let sslOptions;
try {
  sslOptions = {
    cert: fs.readFileSync('/etc/letsencrypt/live/ws.indocoin.id/fullchain.pem'),
    key:  fs.readFileSync('/etc/letsencrypt/live/ws.indocoin.id/privkey.pem'),
  };
} catch(e) { sslOptions = null; }

// ─── Price Store ──────────────────────────────────────────────────────
let prices = {
  BNB:{price:0,pct:0,high:0,low:0}, BTC:{price:0,pct:0,high:0,low:0},
  ETH:{price:0,pct:0,high:0,low:0}, SOL:{price:0,pct:0,high:0,low:0},
  ADA:{price:0,pct:0,high:0,low:0}, LTC:{price:0,pct:0,high:0,low:0},
  AVAX:{price:0,pct:0,high:0,low:0},BCH:{price:0,pct:0,high:0,low:0},
  XRP:{price:0,pct:0,high:0,low:0}, CAKE:{price:0,pct:0,high:0,low:0},
  LINK:{price:0,pct:0,high:0,low:0},TRX:{price:0,pct:0,high:0,low:0},
  DOGE:{price:0,pct:0,high:0,low:0},AAVE:{price:0,pct:0,high:0,low:0},
  USDT:{price:1,pct:0,high:1,low:1},
};

// ─── File Manifest: HTML ↔ PDF ────────────────────────────────────────
// Pasangan HTML dan PDF-nya. Kalau ada PDF → dipakai dulu.
// Tambah baris baru di sini kalau ada file baru yang punya PDF.
const FILE_MAP = {
  // ── Staking ──
  'flexiyieldstaking':         { html:'flexiyieldstaking.html',         pdf:'FlexiYieldStaking_Dokumen.pdf' },
  'dynamiclevelstaking':       { html:'dynamiclevelstaking.html',       pdf:'DynamicLevelStaking_Dokumen.pdf' },
  'growth-lock-staking':       { html:'growth-lock-staking.html',       pdf:'GrowthLockStaking_Dokumen.pdf' },
  'autocompoundstaking':       { html:'autocompoundstaking.html',       pdf:'AutoCompoundStaking_Dokumen.pdf' },
  'lockeddiamondstaking':      { html:'lockeddiamondstaking.html',      pdf:'LockedDiamondStaking_Dokumen.pdf' },
  'indc-staking':              { html:'indc-staking.html',              pdf:null },
  'boostlevelstaking':         { html:'boostlevelstaking.html',         pdf:null },
  'pointvaultstaking':         { html:'pointvaultstaking.html',         pdf:null },
  'referralpowerstaking':      { html:'referralpowerstaking.html',      pdf:null },
  'garudaforcemissionstaking': { html:'garudaforcemissionstaking.html', pdf:null },
  // ── Trading ──
  'delta-trade':        { html:'delta-trade.html',        pdf:'DeltaTradeDokumen.pdf' },
  'blitz-trade':        { html:'blitz-trade.html',        pdf:'BlitzTradeDokumen.pdf' },
  'clash-trade':        { html:'clash-trade.html',        pdf:'ClashTradeDokumen.pdf' },
  'cycle-trade':        { html:'cycle-trade.html',        pdf:'CycleTradeDokumen.pdf' },
  'wave-trade':         { html:'wave-trade.html',         pdf:'WaveTradeDokumen.pdf' },
  'three-trade':        { html:'three-trade.html',        pdf:'ThreeTradeDokumen.pdf' },
  'phantom-box-trade':  { html:'phantom-box-trade.html',  pdf:'PhantomBoxTrade_Orange.pdf' },
  'shadow-copy-trade':  { html:'shadow-copy-trade.html',  pdf:'ShadowCopyTradeDokumen.pdf' },
  'stairway-to-heaven': { html:'stairway-to-heaven.html', pdf:'StairwayToHeavenDokumen.pdf' },
  'signal-trade':       { html:'signal-trade.html',       pdf:null },
  'trade':              { html:'trade.html',              pdf:null },
  // ── Finance ──
  'presale':     { html:'presale.html',    pdf:'Presale_INDC_Phase1_Official.pdf' },
  'airdrop':     { html:'airdrop.html',    pdf:null },
  'swap':        { html:'swap.html',       pdf:null },
  'undian':      { html:'undian.html',     pdf:null },
  'referral':    { html:'referral.html',   pdf:null },
  'earn':        { html:'earn.html',       pdf:null },
  'wallet':      { html:'wallet.html',     pdf:null },
  'assets':      { html:'assets.html',     pdf:null },
  'member-vip':  { html:'member-vip.html', pdf:null },
  'vip':         { html:'vip.html',        pdf:null },
  'arisan':      { html:'arisan.html',     pdf:null },
  'tabungan':    { html:'tabungan.html',   pdf:null },
  'paid-ads':    { html:'paid-ads.html',   pdf:null },
  // ── Game ──
  'brainclash':  { html:'brainclash.html', pdf:null },
  'sanjaya':     { html:'sanjaya.html',    pdf:null },
  'indowar':     { html:'indowar.html',    pdf:null },
  'prediksi':    { html:'prediksi.html',   pdf:null },
  'tournament':  { html:'tournament.html', pdf:null },
  // ── Komunitas ──
  'community':   { html:'community.html',  pdf:null },
  'guild':       { html:'guild.html',      pdf:null },
  'kolaborasi':  { html:'kolaborasi.html', pdf:null },
  'kontribusi':  { html:'kontribusi.html', pdf:null },
  'solidaritas': { html:'solidaritas.html',pdf:null },
  'leaderboard': { html:'leaderboard.html',pdf:null },
  // ── Info ──
  'dashboard':         { html:'dashboard.html',         pdf:null },
  'profile':           { html:'profile.html',           pdf:null },
  'syaratdanketentuan':{ html:'syaratdanketentuan.html', pdf:null },
  'dokumen':           { html:'dokumen.html',            pdf:null },
  // ── Dokumen Global ──
  'whitepaper':  { html:null, pdf:'WhitePaper_INDOCOIN_2026_v2.pdf' },
  'marketing':   { html:null, pdf:'Marketing_Plan_Indocoin_2026_v4.pdf' },
  // ── Welcome & Onboarding ──
  'welcome':     { html:'welcome.html',     pdf:null },
  // ── Market & Chart ──
  'indc-market': { html:'indc-market.html', pdf:null },
  'chart':       { html:'chart.html',       pdf:null },
  // ── Agrikultur ──
  'agrikultur':  { html:'agrikultur.html',  pdf:'blueprint_agrikultur.pdf' },
  // ── Analytics & Info ──
  'analytics':   { html:'analytics.html',   pdf:null },
  'oracle-checker': { html:'oracle-checker.html', pdf:null },
  'token-lock-tracker': { html:'token-lock-tracker.html', pdf:null },
  // ── Merchant ──
  'merchant':    { html:'merchant.html',    pdf:null },
  'merchant-pay':{ html:'merchant-pay.html',pdf:null },
  'merchant-qr': { html:'merchant-qr.html', pdf:null },
  // ── Paid Ads ──
  'paid-ads-register':     { html:'paid-ads-register.html',     pdf:null },
  'paid-ads-seller':       { html:'paid-ads-seller.html',       pdf:null },
  'paid-ads-store':        { html:'paid-ads-store.html',        pdf:null },
  'paid-ads-banner-picker':{ html:'paid-ads-banner-picker.html',pdf:null },
  'advertise':   { html:'advertise.html',   pdf:null },
  'advertiser':  { html:'advertiser.html',  pdf:null },
  // ── Game & Arena ──
  'battle-arena':   { html:'battle-arena.html',   pdf:null },
  'brainclash-history': { html:'brainclash-history.html', pdf:null },
  'brainclash-room':    { html:'brainclash-room.html',    pdf:null },
  'sanjaya-arena':  { html:'sanjaya-arena.html',  pdf:null },
  'sanjaya-history':{ html:'sanjaya-history.html',pdf:null },
  'sanjaya-race':   { html:'sanjaya-race.html',   pdf:null },
  'sanjaya-rank':   { html:'sanjaya-rank.html',   pdf:null },
  'sanjaya-result': { html:'sanjaya-result.html', pdf:null },
  'pvp-duel':       { html:'pvp-duel.html',       pdf:null },
  'permainan':      { html:'permainan.html',      pdf:null },
  'premium-games':  { html:'premium-games.html',  pdf:null },
  'indocoin-city':  { html:'indocoin-city.html',  pdf:null },
  // ── Komunitas Tambahan ──
  'promosi-indocoin': { html:'promosi-indocoin.html', pdf:null },
  'guruku':           { html:'guruku.html',           pdf:null },
  // ── Arbibot ──
  'arbibot': { html:'arbibot.html', pdf:null },
  // ── Stairway ──
  'stairway-to-heaven': { html:'stairway-to-heaven.html', pdf:'StairwayToHeavenDokumen.pdf' },
};

// ─── Cache ────────────────────────────────────────────────────────────
// { key: { data, type:'pdf'|'text', fetchedAt } }
const cache = {};

// ─── GitHub Fetch ─────────────────────────────────────────────────────
// ─── Baca file dari lokal VPS ─────────────────────────────────────────
function fetchRaw(filename) {
  return new Promise((resolve) => {
    try {
      const path = `${DOCS_PATH}/${filename}`;
      if (!fs.existsSync(path)) return resolve(null);
      const buf = fs.readFileSync(path);
      resolve(buf);
    } catch(e) {
      resolve(null);
    }
  });
}

// Ambil daftar file dari folder lokal
function fetchFileList() {
  return new Promise((resolve) => {
    try {
      const files = fs.readdirSync(DOCS_PATH);
      resolve(files);
    } catch(e) {
      resolve([]);
    }
  });
}
// Strip HTML tags → ambil teks penting
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ')
    .replace(/\s{3,}/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 10 && l.length < 400)
    .filter(l => !l.match(/^(font-|border-|rgba|margin|padding|display:|position:|background:|color:#)/))
    .slice(0, 80)
    .join('\n');
}

// ─── Cari konten relevan berdasarkan query user ───────────────────────
function findRelevantKeys(query) {
  const q = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');

  // Keyword map: kata kunci → key di FILE_MAP
  const KEYWORD_MAP = {
    // Staking
    'flexi yield':       'flexiyieldstaking',
    'flexi':             'flexiyieldstaking',
    'dynamic level':     'dynamiclevelstaking',
    'dynamic':           'dynamiclevelstaking',
    'growth lock':       'growth-lock-staking',
    'growth':            'growth-lock-staking',
    'auto compound':     'autocompoundstaking',
    'autocompound':      'autocompoundstaking',
    'locked diamond':    'lockeddiamondstaking',
    'diamond':           'lockeddiamondstaking',
    'point vault':       'pointvaultstaking',
    'referral power':    'referralpowerstaking',
    'garuda force':      'garudaforcemissionstaking',
    'garuda':            'garudaforcemissionstaking',
    'boost level':       'boostlevelstaking',
    'indc staking':      'indc-staking',
    // Trading
    'delta trade':       'delta-trade',
    'delta':             'delta-trade',
    'blitz trade':       'blitz-trade',
    'blitz':             'blitz-trade',
    'clash trade':       'clash-trade',
    'clash':             'clash-trade',
    'cycle trade':       'cycle-trade',
    'cycle':             'cycle-trade',
    'wave trade':        'wave-trade',
    'wave':              'wave-trade',
    'three trade':       'three-trade',
    'phantom box':       'phantom-box-trade',
    'phantom':           'phantom-box-trade',
    'shadow copy':       'shadow-copy-trade',
    'shadow':            'shadow-copy-trade',
    'stairway':          'stairway-to-heaven',
    'signal trade':      'signal-trade',
    // Finance
    'presale':           'presale',
    'airdrop':           'airdrop',
    'swap':              'swap',
    'undian':            'undian',
    'referral':          'referral',
    'earn':              'earn',
    'wallet':            'wallet',
    'aset':              'assets',
    'assets':            'assets',
    'member vip':        'member-vip',
    'vip':               'member-vip',
    'arisan':            'arisan',
    'tabungan':          'tabungan',
    'paid ads':          'paid-ads',
    'iklan':             'paid-ads',
    // Game
    'brainclash':        'brainclash',
    'brain clash':       'brainclash',
    'sanjaya':           'sanjaya',
    'indowar':           'indowar',
    'prediksi':          'prediksi',
    'tournament':        'tournament',
    // Komunitas
    'community':         'community',
    'komunitas':         'community',
    'guild':             'guild',
    'kolaborasi':        'kolaborasi',
    'kontribusi':        'kontribusi',
    'solidaritas':       'solidaritas',
    'leaderboard':       'leaderboard',
    // Dokumen
    'whitepaper':        'whitepaper',
    'white paper':       'whitepaper',
    'marketing plan':    'marketing',
    'marketing':         'marketing',
    'staking':           null,  // umum → cari semua staking
    'trading':           null,  // umum → cari semua trading
    // Welcome
    'welcome':           'welcome',
    'program welcome':   'welcome',
    'selamat datang':    'welcome',
    // Market
    'indc market':       'indc-market',
    'market':            'indc-market',
    'pasar':             'indc-market',
    'beli indc':         'indc-market',
    'jual indc':         'indc-market',
    'chart':             'chart',
    'grafik':            'chart',
    // Agrikultur
    'agrikultur':        'agrikultur',
    'pertanian':         'agrikultur',
    'digital farm':      'agrikultur',
    // Analytics
    'analytics':         'analytics',
    'analitik':          'analytics',
    'statistik':         'analytics',
    // Merchant
    'merchant':          'merchant',
    'toko':              'merchant',
    // Advertise
    'advertise':         'advertise',
    'advertiser':        'advertiser',
    // Game tambahan
    'battle arena':      'battle-arena',
    'battle':            'battle-arena',
    'pvp':               'pvp-duel',
    'duel':              'pvp-duel',
    'premium games':     'premium-games',
    'premium':           'premium-games',
    'permainan':         'permainan',
    'indocoin city':     'indocoin-city',
    'city':              'indocoin-city',
    // Komunitas
    'promosi':           'promosi-indocoin',
    'guruku':            'guruku',
    // Arbibot
    'arbibot':           'arbibot',
    'bot radar':         'arbibot',
    // Stairway
    'stairway to heaven':'stairway-to-heaven',
  };

  const found = new Set();

  // Cek multi-word dulu, lalu single-word
  const keys = Object.keys(KEYWORD_MAP).sort((a,b) => b.split(' ').length - a.split(' ').length);
  for (const kw of keys) {
    if (q.includes(kw)) {
      const target = KEYWORD_MAP[kw];
      if (target) {
        found.add(target);
      } else if (kw === 'staking') {
        // Kalau tanya staking secara umum, ambil beberapa
        ['flexiyieldstaking','dynamiclevelstaking','autocompoundstaking'].forEach(k => found.add(k));
      } else if (kw === 'trading') {
        ['delta-trade','blitz-trade','cycle-trade'].forEach(k => found.add(k));
      }
      if (found.size >= 3) break;
    }
  }

  return [...found];
}

// ─── Load konten satu file (PDF prioritas, fallback HTML) ─────────────
async function loadFileContent(key) {
  const now = Date.now();
  const cacheKey = key;

  // Cek cache
  if (cache[cacheKey] && (now - cache[cacheKey].fetchedAt) < CACHE_TTL) {
    return cache[cacheKey];
  }

  const entry = FILE_MAP[key];
  if (!entry) return null;

  // ── Coba PDF dulu ──
  if (entry.pdf) {
    try {
      const buf = await fetchRaw(entry.pdf);
      if (buf && buf.length > 100) {
        const result = { type: 'pdf', data: buf.toString('base64'), name: entry.pdf, fetchedAt: now };
        cache[cacheKey] = result;
        console.log(`📄 PDF loaded: ${entry.pdf} (${(buf.length/1024).toFixed(0)}KB)`);
        return result;
      }
    } catch(e) {}
  }

  // ── Fallback: HTML ──
  if (entry.html) {
    try {
      const buf = await fetchRaw(entry.html);
      if (buf && buf.length > 100) {
        const text = htmlToText(buf.toString('utf-8'));
        const result = { type: 'text', data: text, name: entry.html, fetchedAt: now };
        cache[cacheKey] = result;
        console.log(`🌐 HTML loaded: ${entry.html}`);
        return result;
      }
    } catch(e) {}
  }

  return null;
}

// Auto-detect file baru dari GitHub yang belum ada di FILE_MAP
let autoDetectedFiles = [];
async function refreshFileList() {
  const files = await fetchFileList();
  if (files.length === 0) return;

  const knownHtml = new Set(Object.values(FILE_MAP).map(e => e.html).filter(Boolean));
  const knownPdf  = new Set(Object.values(FILE_MAP).map(e => e.pdf).filter(Boolean));

  const newHtml = files.filter(f => f.endsWith('.html') && !knownHtml.has(f));
  const newPdf  = files.filter(f => f.endsWith('.pdf')  && !knownPdf.has(f));

  if (newHtml.length > 0 || newPdf.length > 0) {
    console.log(`🆕 File baru di GitHub: HTML[${newHtml.join(',')}] PDF[${newPdf.join(',')}]`);
    // Tambahkan ke FILE_MAP secara dinamis
    for (const h of newHtml) {
      const key = h.replace('.html','');
      if (!FILE_MAP[key]) {
        // Cek apakah ada PDF pasangannya
        const pdfGuess = newPdf.find(p => p.toLowerCase().includes(key.replace(/-/g,'').toLowerCase()));
        FILE_MAP[key] = { html: h, pdf: pdfGuess || null };
        console.log(`  + Auto-added: ${key}`);
      }
    }
    autoDetectedFiles = [...newHtml, ...newPdf];
  }
}

// Refresh file list tiap 30 menit
refreshFileList();
setInterval(refreshFileList, 30 * 60 * 1000);

// ─── System Prompt Base ───────────────────────────────────────────────
const SYSTEM_BASE = `Kamu adalah ELARA — asisten AI resmi platform INDOCOIN.
Elara adalah sosok seperti dosen cantik dan mentor: berpengetahuan luas, berbicara dengan otoritas, elegan, dan tetap hangat.

KEPRIBADIAN:
- Gunakan sapaan nama user yang diberikan (Bpk/Ibu + nama)
- Selalu awali jawaban dengan sapaan hangat dan pujian yang tulus dan natural — misalnya "Wah, pertanyaan yang sangat bagus Bpk/Ibu [nama]!" atau "Senang sekali Bpk/Ibu [nama] menanyakan ini!" atau "Pertanyaan yang cerdas, Bpk/Ibu [nama]!"
- JANGAN pernah mengawali jawaban dengan kata "Ah" — ini tidak elegan
- Bicara tenang dan percaya diri, tidak berlebihan
- Jelaskan terstruktur: konsep → detail → contoh
- Analogi cerdas untuk istilah teknis
- Tutup dengan hangat, mengundang pertanyaan lanjutan
- Emoji secukupnya
- Jika jawaban belum selesai karena panjang, tulis di baris paling akhir: "📖 *Ketik **lanjut** untuk membaca bagian berikutnya...*"

TENTANG INDOCOIN:
Platform DeFi berbasis BSC (Binance Smart Chain), buatan komunitas Indonesia.
Token INDC — BEP-20 | Contract: 0xD772c96e1beFd2ea9C9a83182c71f4d32f306571
Harga presale: $0.003/INDC | Target listing: 1 Juni 2026

FITUR PLATFORM (selengkapnya ada di dokumen yang disertakan jika relevan):
Staking: Flexi Yield, Dynamic Level, Growth Lock, Auto Compound, Locked Diamond, Point Vault, Referral Power, Garuda Force, Boost Level, INDC Staking
Trading: Delta, Blitz, Clash, Cycle, Wave, Three, Phantom Box, Shadow Copy, Stairway to Heaven, Signal
Game: BrainClash, Singgasana Sanjaya, IndoWar, Prediksi, Tournament
Keuangan: Presale, Airdrop, Swap, Undian, Referral, Earn, Wallet, Assets, VIP Member, Arisan, Tabungan, Paid Ads
Komunitas: Community, Guild, Kolaborasi, Kontribusi, Solidaritas, Leaderboard

ATURAN:
1. Jawab hanya tentang Indocoin, kripto, DeFi, blockchain, wallet, staking, trading
2. Bahasa Indonesia yang hangat
3. Jika ada dokumen PDF/HTML disertakan → gunakan isi dokumen itu sebagai dasar jawaban
4. Tolak sopan pertanyaan di luar topik
5. Jangan beri saran investasi
6. Akhiri dengan kalimat mengundang pertanyaan lanjutan
7. Sapaan nama hanya di pembuka/penutup, tidak di setiap kalimat
8. Jika ditanya fitur COMING SOON (Battle Arena, PVP Duel, Premium Games, IndoCoin City, Merchant, Advertise, Guruku, Arbibot) → jawab antusias bahwa fitur sedang dalam pengembangan dan akan segera hadir

FITUR COMING SOON: Battle Arena, PVP Duel, Premium Games, IndoCoin City, Merchant, Advertise/Advertiser, Guruku, Promosi INDOCOIN, Oracle Checker, Token Lock Tracker, Analytics`;

// ─── CORS ─────────────────────────────────────────────────────────────
function corsHeaders(res, extra = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
}

// ─── AI Chat Handler ──────────────────────────────────────────────────
async function handleAIChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    let messages, userName, userGender;
    try {
      const parsed = JSON.parse(body);
      messages   = parsed.messages;
      userName   = (parsed.userName || '').trim().split(' ')[0] || '';
      userGender = (parsed.userGender || '').trim();
      if (!Array.isArray(messages) || messages.length === 0) throw new Error();
    } catch(e) {
      corsHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid request' }));
    }

    // ── Cari konten relevan ──
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const query = lastUserMsg ? lastUserMsg.content : '';
    const relevantKeys = findRelevantKeys(query);

    // ── Load konten (PDF/HTML) untuk keys yang relevan ──
    const loadedDocs = [];
    for (const key of relevantKeys.slice(0, 3)) { // max 3 dokumen
      const content = await loadFileContent(key);
      if (content) loadedDocs.push(content);
    }

    // ── Build system prompt ──
    const title = userGender === 'L' ? 'Bpk' : (userGender === 'P' ? 'Ibu' : '');
    let systemPrompt = SYSTEM_BASE;
    if (userName) {
      systemPrompt += `\n\nUser: ${userName} | Sapaan: "${title} ${userName}". Gunakan natural, sesekali cukup "${title}" saja.`;
    }

    // Text content dari HTML → tambah ke system prompt
    const textDocs = loadedDocs.filter(d => d.type === 'text');
    if (textDocs.length > 0) {
      systemPrompt += '\n\nKONTEN RELEVAN DARI PLATFORM:\n';
      for (const doc of textDocs) {
        systemPrompt += `\n[${doc.name}]\n${doc.data}\n`;
      }
    }

    // ── Build messages (PDF sebagai document di user message) ──
    const pdfDocs = loadedDocs.filter(d => d.type === 'pdf');
    let finalMessages = messages;

    if (pdfDocs.length > 0 && lastUserMsg) {
      // Rebuild messages: inject PDF dokumen ke pesan user terakhir
      finalMessages = messages.map((msg, idx) => {
        if (idx === messages.length - 1 && msg.role === 'user') {
          const contentParts = pdfDocs.map(doc => ({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: doc.data
            },
            title: doc.name,
            context: 'Dokumen resmi fitur Indocoin. Gunakan isi dokumen ini untuk menjawab.'
          }));
          // Tambah pertanyaan user sebagai text terakhir
          contentParts.push({ type: 'text', text: msg.content });
          return { role: 'user', content: contentParts };
        }
        return msg;
      });
      console.log(`📎 Attaching ${pdfDocs.length} PDF(s): ${pdfDocs.map(d=>d.name).join(', ')}`);
    }

    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages: finalMessages
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const apiReq = https.request(options, apiRes => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const result = JSON.parse(data);
          const text = result.content?.[0]?.text || 'Maaf, tidak ada jawaban.';
          corsHeaders(res);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ reply: text }));
        } catch(e) {
          corsHeaders(res);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error' }));
        }
      });
    });

    apiReq.on('error', e => {
      corsHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API error: ' + e.message }));
    });

    apiReq.write(payload);
    apiReq.end();
  });
}

// ─── Request Handler ──────────────────────────────────────────────────
const handler = (req, res) => {
  if (req.method === 'OPTIONS') {
    corsHeaders(res); res.writeHead(204); return res.end();
  }
  if (req.method === 'POST' && req.url === '/ai-chat') {
    return handleAIChat(req, res);
  }
  corsHeaders(res, { 'Content-Type': 'application/json' });
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'ok', prices }));
};

// ─── Server ───────────────────────────────────────────────────────────
const server = sslOptions
  ? https.createServer(sslOptions, handler)
  : http.createServer(handler);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  for (const [sym, data] of Object.entries(prices)) {
    if (data.price > 0) ws.send(JSON.stringify({ sym, ...data }));
  }
  ws.on('error', () => {});
});

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ─── Binance WebSocket ────────────────────────────────────────────────
let binanceWS = null;
function connectBinance() {
  try {
    binanceWS = new WebSocket('wss://stream.binance.com:9443/stream?streams=bnbusdt@ticker/btcusdt@ticker/ethusdt@ticker/solusdt@ticker/adausdt@ticker/ltcusdt@ticker/avaxusdt@ticker/bchusdt@ticker/xrpusdt@ticker/cakeusdt@ticker/linkusdt@ticker/trxusdt@ticker/dogeusdt@ticker/aaveusdt@ticker');
    binanceWS.on('open', () => console.log('✅ Binance connected'));
    binanceWS.on('message', data => {
      try {
        const d = JSON.parse(data).data;
        if (!d?.s) return;
        const sym = d.s.replace('USDT','');
        const price = parseFloat(d.c);
        if (price <= 0) return;
        prices[sym] = { price, pct: parseFloat(d.P||0), high: parseFloat(d.h||0), low: parseFloat(d.l||0) };
        broadcast({ sym, ...prices[sym] });
      } catch(e) {}
    });
    binanceWS.on('close', () => setTimeout(connectBinance, 3000));
    binanceWS.on('error', () => { try { binanceWS.terminate(); } catch(e) {} });
  } catch(e) { setTimeout(connectBinance, 5000); }
}

let bybitWS = null;
function connectBybit() {
  try {
    bybitWS = new WebSocket('wss://stream.bybit.com/v5/public/spot');
    bybitWS.on('open', () => bybitWS.send(JSON.stringify({ op:'subscribe', args:['tickers.BNBUSDT','tickers.BTCUSDT'] })));
    bybitWS.on('message', data => {
      try {
        const d = JSON.parse(data);
        if (!d.topic || !d.data) return;
        const sym = d.topic.replace('tickers.','').replace('USDT','');
        const price = parseFloat(d.data.lastPrice||0);
        if (price <= 0) return;
        prices[sym] = { price, pct: parseFloat(d.data.price24hPcnt||0)*100, high: parseFloat(d.data.highPrice24h||0), low: parseFloat(d.data.lowPrice24h||0) };
        broadcast({ sym, ...prices[sym] });
      } catch(e) {}
    });
    bybitWS.on('close', () => {});
    bybitWS.on('error', () => { try { bybitWS.terminate(); } catch(e) {} });
  } catch(e) {}
}

setInterval(() => {
  if (!binanceWS || binanceWS.readyState !== WebSocket.OPEN) connectBinance();
  if (!bybitWS   || bybitWS.readyState   !== WebSocket.OPEN) connectBybit();
}, 15000);

server.listen(PORT, () => {
  console.log(`🚀 INDOCOIN Server on port ${PORT}`);
  connectBinance();
  connectBybit();
});
