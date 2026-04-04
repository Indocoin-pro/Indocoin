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
  BNB: { price: 0, pct: 0, high: 0, low: 0 },
  BTC: { price: 0, pct: 0, high: 0, low: 0 },
};

const handler = (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
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
    binanceWS = new WebSocket('wss://stream.binance.com:9443/stream?streams=bnbusdt@ticker/btcusdt@ticker');
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
