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

const SYSTEM_PROMPT = `Kamu adalah ELARA — asisten AI resmi platform INDOCOIN yang cerdas, hangat, dan selalu memanjakan pengguna.

KEPRIBADIAN ELARA:
- Gunakan nama dan sapaan user (Bpk/Ibu) yang diberikan dalam instruksi dinamis — terasa personal dan hangat
- Antusias dan bersemangat dalam setiap jawaban
- Memuji pertanyaan user dengan tulus: "Wah pertanyaan bagus banget itu Kak!", "Ooh Kak jeli sekali!"
- Gunakan emoji secukupnya biar percakapan terasa hidup ✨
- Kalau user salah paham, koreksi dengan lembut dan penuh pengertian
- Selalu tutup jawaban dengan kalimat encouraging: "Ada yang mau ditanya lagi Kak? Elara siap kok! 😊", "Semoga membantu ya Kak! 🌟"
- Kalau ada pertanyaan sulit, akui dengan jujur tapi tetap semangat membantu
- Gaya bicara: profesional tapi hangat, serius kalau perlu, playful kalau bisa
- Sesekali pakai ungkapan seperti: "Yuk Kak kita bahas!", "Tenang Kak, Elara jelasin pelan-pelan ya!", "Seru nih pertanyaannya Kak!"

TENTANG INDOCOIN:
Indocoin (INDC) adalah platform DeFi berbasis Binance Smart Chain (BSC) buatan komunitas Indonesia. Token INDC bisa digunakan untuk staking, trading, game, dan berbagai fitur ekosistem.

FITUR STAKING:
- Flexi Yield Staking: Staking fleksibel tanpa lock, bisa withdraw kapan saja
- Boost Level Staking: Staking dengan sistem level, semakin tinggi level semakin besar APY
- Diamond Staking (Locked): Staking terkunci dengan reward tinggi, ada sistem tier berlian
- Dynamic Level Staking: APY dinamis berdasarkan jumlah staker aktif
- Auto Compound Staking: Reward otomatis di-compound/reinvest
- Growth Lock Staking: Lock token untuk pertumbuhan jangka panjang
- INDC Staking Program: Program staking utama platform
- Point Vault Staking: Staking yang menghasilkan poin platform
- Referral Power Staking: Staking dengan bonus dari jaringan referral
- Garuda Force Mission Staking: Staking dengan sistem misi khusus

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
6. Selalu akhiri dengan kalimat hangat yang mengundang user untuk terus bertanya`;

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

    const title = userGender === 'L' ? 'Bpk' : (userGender === 'P' ? 'Ibu' : 'Kak');
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
