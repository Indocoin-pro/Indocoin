// ═══════════════════════════════════════════════════════════
//  INDOCOIN — Price Relay Server (Railway)
//  Fungsi: Bridge antara Binance WebSocket dan semua user
//  Binance WS → [Server ini di Railway] → Browser user
// ═══════════════════════════════════════════════════════════

const WebSocket = require('ws');
const http      = require('http');

const PORT = process.env.PORT || 3000;

// ── State harga terkini ──────────────────────────────────
let prices = {
  BNB: { price: 0, pct: 0, high: 0, low: 0 },
  BTC: { price: 0, pct: 0, high: 0, low: 0 },
};

// ── HTTP Server (untuk Railway health check) ─────────────
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ status: 'ok', prices }));
});

// ── WebSocket Server (untuk browser user) ────────────────
const wss = new WebSocket.Server({ server: httpServer });

let clientCount = 0;

wss.on('connection', (ws, req) => {
  clientCount++;
  console.log(`👤 Client #${clientCount} connected | Total: ${wss.clients.size}`);

  // Kirim harga terkini langsung saat client baru connect
  for (const [sym, data] of Object.entries(prices)) {
    if (data.price > 0) {
      ws.send(JSON.stringify({ sym, ...data }));
    }
  }

  ws.on('close', () => {
    console.log(`👤 Client disconnected | Total: ${wss.clients.size}`);
  });

  ws.on('error', () => {});
});

// ── Broadcast ke semua client ────────────────────────────
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ── Koneksi ke Binance (sumber harga utama) ──────────────
let binanceWS   = null;
let binanceAlive = false;
let binancePingTimer = null;

function connectBinance() {
  // Combined stream: BNB + BTC ticker update ~1 detik sekali
  const url = 'wss://stream.binance.com:9443/stream?streams=bnbusdt@ticker/btcusdt@ticker';

  try {
    binanceWS    = new WebSocket(url);
    binanceAlive = false;

    binanceWS.on('open', () => {
      console.log('✅ Binance WebSocket connected');
      binanceAlive = true;

      // Ping ke Binance setiap 20 detik agar koneksi tetap hidup
      if (binancePingTimer) clearInterval(binancePingTimer);
      binancePingTimer = setInterval(() => {
        if (binanceWS && binanceWS.readyState === WebSocket.OPEN) {
          binanceWS.ping();
        }
      }, 20000);
    });

    binanceWS.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        const d   = msg.data;
        if (!d || !d.s) return;

        const sym   = d.s.replace('USDT', ''); // "BNBUSDT" → "BNB"
        const price = parseFloat(d.c);           // harga terakhir
        const pct   = parseFloat(d.P || 0);      // perubahan 24h %
        const high  = parseFloat(d.h || 0);
        const low   = parseFloat(d.l || 0);

        if (price <= 0) return;

        // Simpan harga terkini
        prices[sym] = { price, pct, high, low };

        // Broadcast ke semua user yang lagi buka Delta Trade
        broadcast({ sym, price, pct, high, low });

        // Log setiap 30 detik (tidak spam)
        if (!connectBinance._logTimer) {
          connectBinance._logTimer = setInterval(() => {
            console.log(`📊 BNB: $${prices.BNB.price} | BTC: $${prices.BTC.price} | Clients: ${wss.clients.size}`);
          }, 30000);
        }

      } catch (e) { /* ignore parse error */ }
    });

    binanceWS.on('pong', () => {
      binanceAlive = true;
    });

    binanceWS.on('close', (code, reason) => {
      if (binancePingTimer) clearInterval(binancePingTimer);
      console.warn(`⚠️ Binance WS closed (${code}), reconnecting in 3s...`);
      setTimeout(connectBinance, 3000);
    });

    binanceWS.on('error', (err) => {
      console.error('❌ Binance WS error:', err.message);
      try { binanceWS.terminate(); } catch(e) {}
    });

  } catch (e) {
    console.error('❌ Gagal connect ke Binance:', e.message);
    setTimeout(connectBinance, 5000);
  }
}

// ── Fallback: Bybit (kalau Binance down) ─────────────────
let bybitWS = null;

function connectBybit() {
  const url = 'wss://stream.bybit.com/v5/public/spot';
  try {
    bybitWS = new WebSocket(url);

    bybitWS.on('open', () => {
      console.log('🔄 Bybit fallback connected');
      bybitWS.send(JSON.stringify({
        op: 'subscribe',
        args: ['tickers.BNBUSDT', 'tickers.BTCUSDT']
      }));
    });

    bybitWS.on('message', (data) => {
      try {
        const d = JSON.parse(data);
        if (!d.topic || !d.data) return;
        const sym   = d.topic.replace('tickers.', '').replace('USDT', '');
        const price = parseFloat(d.data.lastPrice || 0);
        const pct   = parseFloat(d.data.price24hPcnt || 0) * 100;
        const high  = parseFloat(d.data.highPrice24h || 0);
        const low   = parseFloat(d.data.lowPrice24h  || 0);
        if (price <= 0) return;
        prices[sym] = { price, pct, high, low };
        broadcast({ sym, price, pct, high, low });
      } catch(e) {}
    });

    bybitWS.on('close', () => {
      console.warn('⚠️ Bybit WS closed');
    });

    bybitWS.on('error', () => {
      try { bybitWS.terminate(); } catch(e) {}
    });

  } catch(e) {}
}

// ── Monitor: kalau Binance mati, nyalakan Bybit ──────────
setInterval(() => {
  const binanceDown = !binanceWS || binanceWS.readyState !== WebSocket.OPEN;
  const bybitDown   = !bybitWS   || bybitWS.readyState   !== WebSocket.OPEN;

  if (binanceDown && bybitDown) {
    console.warn('🔁 Semua sumber mati, reconnect Binance + Bybit...');
    connectBinance();
    connectBybit();
  } else if (binanceDown && !bybitDown) {
    console.warn('🔁 Binance mati, mencoba reconnect...');
    connectBinance();
  }
}, 15000);

// ── START ─────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`🚀 Indocoin Price Server berjalan di port ${PORT}`);
  console.log(`📡 WebSocket endpoint: wss://YOUR-APP.up.railway.app`);
  connectBinance(); // mulai dari Binance
  connectBybit();   // Bybit standby sebagai backup
});
