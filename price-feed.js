// ═══════════════════════════════════════════════════════════════════
//  INDOCOIN — Price Feed Server
//  Standalone WebSocket server, port 3002
//  Binance (utama) + Bybit (backup) → broadcast ke semua client
//  PM2: pm2 start price-feed.js --name price-feed
// ═══════════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const http      = require('http');

const PORT = 3002;

// ─── Price Store ──────────────────────────────────────────────────
let prices = {
  BNB: {price:0,pct:0,high:0,low:0}, BTC: {price:0,pct:0,high:0,low:0},
  ETH: {price:0,pct:0,high:0,low:0}, SOL: {price:0,pct:0,high:0,low:0},
  ADA: {price:0,pct:0,high:0,low:0}, LTC: {price:0,pct:0,high:0,low:0},
  AVAX:{price:0,pct:0,high:0,low:0}, BCH: {price:0,pct:0,high:0,low:0},
  XRP: {price:0,pct:0,high:0,low:0}, CAKE:{price:0,pct:0,high:0,low:0},
  LINK:{price:0,pct:0,high:0,low:0}, TRX: {price:0,pct:0,high:0,low:0},
  DOGE:{price:0,pct:0,high:0,low:0}, AAVE:{price:0,pct:0,high:0,low:0},
  USDT:{price:1,pct:0,high:1,low:1},
};

// ─── HTTP Server (health check + snapshot) ────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok', service: 'price-feed', port: PORT }));
  }
  if (req.url === '/prices') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok', prices }));
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

// ─── WebSocket Server ─────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  // Kirim semua harga saat ini ke client baru
  for (const [sym, data] of Object.entries(prices)) {
    if (data.price > 0) ws.send(JSON.stringify({ sym, ...data }));
  }
  ws.on('error', () => {});
});

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// ─── Binance WebSocket (utama) ────────────────────────────────────
let binanceWS = null;
function connectBinance() {
  try {
    const streams = [
      'bnbusdt','btcusdt','ethusdt','solusdt','adausdt','ltcusdt',
      'avaxusdt','bchusdt','xrpusdt','cakeusdt','linkusdt','trxusdt',
      'dogeusdt','aaveusdt'
    ].map(s => s + '@ticker').join('/');
    binanceWS = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    binanceWS.on('open', () => console.log('✅ Binance connected'));
    binanceWS.on('message', data => {
      try {
        const d = JSON.parse(data).data;
        if (!d?.s) return;
        const sym   = d.s.replace('USDT', '');
        const price = parseFloat(d.c);
        if (price <= 0) return;
        prices[sym] = { price, pct: parseFloat(d.P||0), high: parseFloat(d.h||0), low: parseFloat(d.l||0) };
        broadcast({ sym, ...prices[sym] });
      } catch(e) {}
    });
    binanceWS.on('close', () => { console.log('⚠️ Binance closed, reconnect 3s'); setTimeout(connectBinance, 3000); });
    binanceWS.on('error', () => { try { binanceWS.terminate(); } catch(e) {} });
  } catch(e) { setTimeout(connectBinance, 5000); }
}

// ─── Bybit WebSocket (backup BNB & BTC) ──────────────────────────
let bybitWS = null;
function connectBybit() {
  try {
    bybitWS = new WebSocket('wss://stream.bybit.com/v5/public/spot');
    bybitWS.on('open', () => {
      bybitWS.send(JSON.stringify({ op: 'subscribe', args: ['tickers.BNBUSDT', 'tickers.BTCUSDT'] }));
    });
    bybitWS.on('message', data => {
      try {
        const d = JSON.parse(data);
        if (!d.topic || !d.data) return;
        const sym   = d.topic.replace('tickers.', '').replace('USDT', '');
        const price = parseFloat(d.data.lastPrice || 0);
        if (price <= 0) return;
        // Bybit hanya update jika Binance tidak aktif
        if (binanceWS && binanceWS.readyState === WebSocket.OPEN) return;
        prices[sym] = { price, pct: parseFloat(d.data.price24hPcnt||0)*100, high: parseFloat(d.data.highPrice24h||0), low: parseFloat(d.data.lowPrice24h||0) };
        broadcast({ sym, ...prices[sym] });
      } catch(e) {}
    });
    bybitWS.on('close', () => {});
    bybitWS.on('error', () => { try { bybitWS.terminate(); } catch(e) {} });
  } catch(e) {}
}

// ─── Watchdog — reconnect kalau putus ────────────────────────────
setInterval(() => {
  if (!binanceWS || binanceWS.readyState !== WebSocket.OPEN) connectBinance();
  if (!bybitWS   || bybitWS.readyState   !== WebSocket.OPEN) connectBybit();
}, 15000);

// ─── Start ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 Price Feed Server on port ${PORT}`);
  connectBinance();
  connectBybit();
});
