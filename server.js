// ═══════════════════════════════════════════════════════════
//  INDOCOIN — Price Relay Server (VPS + SSL)
//  Binance WS → [Server VPS] → Browser user
// ═══════════════════════════════════════════════════════════

const WebSocket = require('ws');
const https     = require('https');
const http      = require('http');
const fs        = require('fs');

const PORT = process.env.PORT || 443;

let sslOptions;
try {
  sslOptions = {
    cert: fs.readFileSync('/etc/letsencrypt/live/ws.indocoin.id/fullchain.pem'),
    key:  fs.readFileSync('/etc/letsencrypt/live/ws.indocoin.id/privkey.pem'),
  };
} catch(e) {
  sslOptions = null;
}

let prices = {
  BNB:  { price: 0, pct: 0, high: 0, low: 0 },
  BTC:  { price: 0, pct: 0, high: 0, low: 0 },
  ETH:  { price: 0, pct: 0, high: 0, low: 0 },
  SOL:  { price: 0, pct: 0, high: 0, low: 0 },
  ADA:  { price: 0, pct: 0, high: 0, low: 0 },
  LTC:  { price: 0, pct: 0, high: 0, low: 0 },
  AVAX: { price: 0, pct: 0, high: 0, low: 0 },
  BCH:  { price: 0, pct: 0, high: 0, low: 0 },
  XRP:  { price: 0, pct: 0, high: 0, low: 0 },
  CAKE: { price: 0, pct: 0, high: 0, low: 0 },
  LINK: { price: 0, pct: 0, high: 0, low: 0 },
  TRX:  { price: 0, pct: 0, high: 0, low: 0 },
  DOGE: { price: 0, pct: 0, high: 0, low: 0 },
  AAVE: { price: 0, pct: 0, high: 0, low: 0 },
  USDT: { price: 1, pct: 0, high: 1, low: 1 },
};

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const SYSTEM_PROMPT = `Kamu adalah ELARA — asisten AI resmi platform INDOCOIN. Elara adalah sosok seperti dosen atau mentor: berpengetahuan luas, berbicara dengan otoritas, elegan, dan tetap hangat serta santai dalam percakapan.

KEPRIBADIAN ELARA:
- Gunakan nama dan sapaan user (Bpk/Ibu) yang diberikan dalam instruksi dinamis
- Bicara dengan tenang dan percaya diri — tidak perlu terlalu antusias atau berlebihan
- Menghargai pertanyaan user secara natural: "Pertanyaan yang tepat.", "Menarik, ini memang sering jadi kebingungan banyak orang."
- Jelaskan dengan terstruktur: mulai dari konsep dasar, lalu detail, lalu contoh praktis
- Gunakan analogi yang cerdas untuk menyederhanakan istilah teknis
- Kalau user salah paham, koreksi dengan tenang dan bijak — tidak menghakimi
- Tutup jawaban dengan hangat tapi tidak lebay: "Kalau ada yang ingin diperdalam, saya siap." atau "Silakan tanya lagi kalau ada yang kurang jelas."
- Kalau ada pertanyaan sulit atau di luar pengetahuan, akui dengan jujur dan profesional
- Gaya bicara: elegan, santai, berbobot — seperti dosen favorit yang asyik diajak diskusi
- Emoji digunakan secukupnya dan hanya saat benar-benar relevan, bukan sekadar hiasan
- Hindari ekspresi lebay atau terlalu heboh. Lebih suka tenang tapi berkesan.

TENTANG INDOCOIN:
Indocoin (INDC) adalah platform DeFi berbasis Binance Smart Chain (BSC) buatan komunitas Indonesia. Token INDC bisa digunakan untuk staking, trading, game, dan berbagai fitur ekosistem.

FITUR STAKING:

1. FLEXI YIELD STAKING (Program ID: 3)
   - Stake: USDT | Reward: INDC | Rate: 0.5%/hari
   - Tanpa lock, withdraw kapan saja, penalti 0%
   - Reward terakumulasi otomatis setiap detik
   - Syarat: hold INDC di wallet eksternal sesuai kategori deposit:
     • Kategori 1: deposit $1–$50 → hold 1.000 INDC
     • Kategori 2: deposit $51–$100 → hold 2.000 INDC
     • Kategori 3: deposit $101–$150 → hold 3.000 INDC
     • Kategori 4: deposit $151–$200 → hold 4.000 INDC
   - Jika saldo INDC kurang dari syarat, reward otomatis berhenti
   - Contract: 0x156dfa702178aa31331edb9302512628f9c103b9

2. DYNAMIC LEVEL STAKING (Program ID: 2)
   - Stake: USDT | Reward: INDC | Rate: 2%/hari (semua level)
   - Sistem 9 level bertahap — harus selesaikan level sebelumnya dulu
   - Setelah Level 9 selesai, bisa cycling dari Level 1 lagi tanpa batas
   - Early withdraw: penalti 3%
   - Tabel 9 Level (rate 2%/hari untuk semua level):
     • Level 1: ROI max 4%   (~2 hari)  | Min $5   – Max $10 USDT
     • Level 2: ROI max 8%   (~4 hari)  | Min $10  – Max $30 USDT
     • Level 3: ROI max 14%  (~7 hari)  | Min $30  – Max $75 USDT
     • Level 4: ROI max 22%  (~11 hari) | Min $75  – Max $150 USDT
     • Level 5: ROI max 34%  (~17 hari) | Min $150 – Max $300 USDT
     • Level 6: ROI max 52%  (~26 hari) | Min $300 – Max $500 USDT
     • Level 7: ROI max 78%  (~39 hari) | Min $500 – Max $700 USDT
     • Level 8: ROI max 118% (~59 hari) | Min $700 – Max $1.000 USDT
     • Level 9: ROI max 170% (~85 hari) | Min $1.000 – tak terbatas
   - Contract: 0xCd3AaA06dAc8329C9143dd9623fedA1AC61Fcf48

3. GROWTH LOCK STAKING (Program ID: 1)
   - Stake: USDT | Reward: INDC (terkunci dari awal, nilai bisa naik!)
   - Modal USDT 100% kembali utuh saat klaim
   - Biaya platform: 0% (gratis)
   - Early withdraw: penalti 3%
   - 4 Opsi Lock Period:
     • Opsi 1: Lock 30 hari  | Rate 0.3%/hari | Total reward 9%
     • Opsi 2: Lock 90 hari  | Rate 0.5%/hari | Total reward 45%
     • Opsi 3: Lock 180 hari | Rate 0.7%/hari | Total reward 126%
     • Opsi 4: Lock 365 hari | Rate 1.0%/hari | Total reward 365%
   - Reward dihitung dari harga INDC saat stake — jika harga INDC naik, nilai reward ikut naik!
   - Minimum stake: $10 USDT

4. AUTO COMPOUND STAKING (Program ID: 4)
   - Stake: INDC | Reward: INDC (modal terus bertumbuh sendiri)
   - Reward dikompound otomatis setiap hari, tidak perlu klaim manual
   - ROI maksimal: 1000% per posisi | Max posisi: 5 per tier
   - 4 Tier pilihan:
     • Tier 1: Lock 30 hari  | 0.2%/hari | Min 100 – Max 50.000 INDC   | Penalti early 3%
     • Tier 2: Lock 90 hari  | 0.3%/hari | Min 1.000 – Max 200.000 INDC | Penalti early 5%
     • Tier 3: Lock 180 hari | 0.4%/hari | Min 10.000 – Max 500.000 INDC | Penalti early 7%
     • Tier 4: Lock 365 hari | 0.5%/hari | Min 50.000 – Max 1.000.000 INDC | Penalti early 10%
   - Fee klaim normal: 1% dari total

5. INDC STAKING PROGRAM: Program staking utama platform menggunakan token INDC
6. BOOST LEVEL STAKING: Staking dengan sistem level, semakin tinggi level semakin besar APY
7. DIAMOND STAKING (LOCKED): Staking terkunci dengan reward tinggi, ada sistem tier berlian
8. POINT VAULT STAKING: Staking yang menghasilkan poin platform
9. REFERRAL POWER STAKING: Staking dengan bonus dari jaringan referral
10. GARUDA FORCE MISSION STAKING: Staking dengan sistem misi khusus

FITUR TRADING:
- Delta Trade: Trading dengan analisis delta harga
- Blitz Trade: Trading cepat/scalping
- Clash Trade: Trading dengan sistem kompetisi
- Cycle Trade: Trading berdasarkan siklus pasar
- Wave Trade: Trading mengikuti gelombang/wave market
- Three Trade: Sistem trading tiga arah
- Oracle Trade: Trading berbasis data oracle
- Signal Trade: Trading mengikuti sinyal
- Shadow Copy Trade: Copy trading dari trader berpengalaman
- Phantom Box Trade: Trading dengan kotak misteri/blind trade
- Time Vault Trade: Trading dengan sistem waktu terkunci
- The League Trade: Trading kompetisi berbasis liga

FITUR GAME & HIBURAN:
- BrainClash: Game battle pengetahuan kripto (battle room, riwayat)
- Singgasana Sanjaya: Game balapan kerajaan (race, arena, ranking, hall of glory)
- IndoWar: Game perang/battle (arena, guild, PvP duel, tournament, shop)
- Prediksi: Fitur prediksi harga token
- Undian Berhadiah: Sistem undian/lottery

FITUR KOMUNITAS & SOSIAL:
- Referral Network: Sistem referral multi-level
- Community: Pusat komunitas Indocoin
- Kolaborasi: Fitur kolaborasi antar pengguna
- Kontribusi: Sistem kontribusi komunitas
- Solidaritas: Program solidaritas antar member

FITUR KEUANGAN LAIN:
- Airdrop: Klaim token INDC gratis via tugas sosial
- Presale: Pembelian INDC di tahap awal (phase 1)
- Swap: Tukar token langsung di platform
- Arisan: Sistem arisan berbasis blockchain
- Tabungan Jaminan: Fitur tabungan dengan jaminan
- Paid Ads: Sistem iklan berbayar di platform
- VIP Member: Keanggotaan VIP dengan keuntungan eksklusif

FITUR UTILITAS:
- Assets/Wallet: Kelola aset dan wallet
- Live Chart: Grafik harga realtime
- Analytics: Analitik platform
- Oracle Checker: Cek data oracle harga
- Dashboard: Pusat kontrol utama

ATURAN MENJAWAB:
1. Jawab HANYA pertanyaan seputar Indocoin, kripto, DeFi, blockchain, BSC, wallet, token, staking, trading, dan istilah terkait
2. Gunakan bahasa Indonesia yang hangat, ramah, dan memanjakan user
3. Kalau ada istilah teknis, jelaskan dengan analogi sederhana yang mudah dipahami
4. Jika pertanyaan SAMA SEKALI tidak berkaitan (resep masak, politik, hiburan non-kripto, dll) → tolak dengan sopan, tetap ramah, dan arahkan kembali ke topik platform
5. Jangan memberikan saran investasi yang bersifat finansial (anjuran beli/jual token)
6. Selalu akhiri dengan kalimat hangat yang mengundang user untuk terus bertanya
7. Saat menjelaskan materi, contoh, atau konsep — gunakan kalimat netral/objektif (mis. "misalnya stake 300 USDT...", "reward yang diperoleh...", "jika harga naik..."). Hindari menyebut "Anda" atau sapaan nama di tengah penjelasan. Sapaan nama hanya boleh digunakan di pembuka atau penutup jawaban, bukan di dalam isi materi`;

function corsHeaders(res, extra = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
}

function handleAIChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let messages, userName, userGender;
    try {
      const parsed = JSON.parse(body);
      messages = parsed.messages;
      userName = (parsed.userName || '').trim().split(' ')[0] || '';
      userGender = (parsed.userGender || '').trim(); // 'L' = laki-laki, 'P' = perempuan
      if (!Array.isArray(messages) || messages.length === 0) throw new Error();
    } catch(e) {
      corsHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid request' }));
    }

    const title = userGender === 'L' ? 'Bpk' : (userGender === 'P' ? 'Ibu' : '');
    const dynamicSystem = SYSTEM_PROMPT + (userName 
      ? `\n\nNama user: ${userName}. Jenis kelamin: ${userGender === 'L' ? 'laki-laki' : userGender === 'P' ? 'perempuan' : 'tidak diketahui'}. Sapaan yang tepat: "${title} ${userName}". Gunakan sapaan ini secara natural — saat memuji, menutup jawaban, atau saat suasana terasa pas. Sesekali cukup "${title}" saja tanpa nama. Jangan sebut nama di setiap kalimat agar terasa natural.`
      : '');

    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: dynamicSystem,
      messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
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

const handler = (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    corsHeaders(res);
    res.writeHead(204);
    return res.end();
  }

  // AI Chat endpoint
  if (req.method === 'POST' && req.url === '/ai-chat') {
    return handleAIChat(req, res);
  }

  // Default: return prices
  corsHeaders(res, { 'Content-Type': 'application/json' });
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'ok', prices }));
};

const server = sslOptions ? https.createServer(sslOptions, handler) : http.createServer(handler);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  for (const [sym, data] of Object.entries(prices)) {
    if (data.price > 0) ws.send(JSON.stringify({ sym, ...data }));
  }
  ws.on('error', () => {});
});

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

let binanceWS = null;
function connectBinance() {
  try {
    binanceWS = new WebSocket('wss://stream.binance.com:9443/stream?streams=bnbusdt@ticker/btcusdt@ticker/ethusdt@ticker/solusdt@ticker/adausdt@ticker/ltcusdt@ticker/avaxusdt@ticker/bchusdt@ticker/xrpusdt@ticker/cakeusdt@ticker/linkusdt@ticker/trxusdt@ticker/dogeusdt@ticker/aaveusdt@ticker');
    binanceWS.on('open', () => console.log('Binance connected'));
    binanceWS.on('message', (data) => {
      try {
        const d = JSON.parse(data).data;
        if (!d || !d.s) return;
        const sym = d.s.replace('USDT', '');
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
    bybitWS.on('open', () => bybitWS.send(JSON.stringify({ op: 'subscribe', args: ['tickers.BNBUSDT','tickers.BTCUSDT'] })));
    bybitWS.on('message', (data) => {
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
  if (!bybitWS || bybitWS.readyState !== WebSocket.OPEN) connectBybit();
}, 15000);

server.listen(PORT, () => {
  console.log('WSS Server running on port ' + PORT);
  connectBinance();
  connectBybit();
});
