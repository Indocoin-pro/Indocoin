// ═══════════════════════════════════════════════════════════════
//  INDOCOIN — Trading Public Proxy (service mandiri, port 3010)
//  Indodax + Luno + Tokocrypto. Nama file/PM2 tetap indodax-proxy.
//  Tidak menyentuh server.js (Elara) maupun service lain.
//  Hanya meneruskan 4 endpoint data PUBLIK Indodax + cache singkat.
//  Tidak ada API key, tidak ada dana yang lewat.
//
//  Jalur (cermin path Indodax, diawali /indodax):
//    GET /indodax/api/pairs
//    GET /indodax/api/summaries
//    GET /indodax/api/depth/{pairId}
//    GET /indodax/tradingview/history_v2?symbol&tf&from&to
//    GET /luno/markets | /luno/tickers | /luno/orderbook?pair=
//    GET /bittime/exchangeinfo | /bittime/tickers | /bittime/depth?symbol&limit
//    GET /tokocrypto/symbols | /tokocrypto/depth?symbol&limit | /tokocrypto/klines?symbol&interval&limit
//    GET /upbit/markets | /upbit/tickers?markets=IDR-BTC,.. | /upbit/orderbook?market= | /upbit/candles?market&unit&count
//    GET /pintu/prices
//    GET /reku/price | /reku/chart?id&f
//    GET /btse/summary | /btse/orderbook?symbol&depth | /btse/ohlcv?symbol&resolution
//    GET /health
// ═══════════════════════════════════════════════════════════════
const http  = require('http');
const https = require('https');

const PORT = parseInt(process.env.INDODAX_PROXY_PORT || '3010', 10);
const H_INDODAX = 'indodax.com', H_LUNO = 'api.luno.com', H_TOKO = 'www.tokocrypto.com', H_TOKO_MKT = 'www.tokocrypto.site', H_BITTIME = 'openapi.bittime.com', H_UPBIT = 'id-api.upbit.com', H_PINTU = 'api.pintu.co.id', H_REKU = 'api.reku.id', H_BTSE = 'api.btse.id';
const ALLOW_ORIGINS = ['https://indocoin.id', 'https://www.indocoin.id'];

// TTL cache (ms) per jenis endpoint
const TTL = { pairs: 300000, summaries: 5000, depth: 3000, history: 30000, markets: 300000, tickers: 5000, klines: 20000, tickers15: 15000 };
const MAX_STALE = 10 * 60 * 1000;   // data lama masih boleh dipakai saat Indodax error
const MAX_CACHE = 600;              // batas jumlah entri cache

const cache = new Map();            // key -> { body, ts }
const inflight = new Map();         // key -> Promise (gabungkan permintaan sama)

function route(pathname, search) {
  if (pathname === '/indodax/api/pairs')     return { kind: 'pairs',     host: H_INDODAX, up: '/api/pairs' };
  if (pathname === '/indodax/api/summaries') return { kind: 'summaries', host: H_INDODAX, up: '/api/summaries' };
  let m = /^\/indodax\/api\/depth\/([a-z0-9_]{2,30})$/.exec(pathname);
  if (m) return { kind: 'depth', host: H_INDODAX, up: '/api/depth/' + m[1] };
  if (pathname === '/indodax/tradingview/history_v2') {
    const q = new URLSearchParams(search);
    const symbol = q.get('symbol') || '', tf = q.get('tf') || '';
    const from = q.get('from') || '', to = q.get('to') || '';
    if (!/^[A-Za-z0-9_]{2,30}$/.test(symbol)) return null;
    if (!/^(1|15|30|60|240|1D|3D|1W)$/.test(tf)) return null;
    if (!/^\d{1,12}$/.test(from) || !/^\d{1,12}$/.test(to)) return null;
    // bulatkan waktu supaya permintaan mirip bisa berbagi cache
    const step = 30;
    const f = Math.floor(+from / step) * step, t = Math.floor(+to / step) * step;
    return { kind: 'history', host: H_INDODAX, up: `/tradingview/history_v2?from=${f}&to=${t}&tf=${tf}&symbol=${symbol}` };
  }
  // ---- Luno (API publik; candles butuh login, jadi tidak diteruskan) ----
  if (pathname === '/luno/markets') return { kind: 'markets', host: H_LUNO, up: '/api/exchange/1/markets' };
  if (pathname === '/luno/tickers') return { kind: 'tickers', host: H_LUNO, up: '/api/1/tickers' };
  if (pathname === '/luno/orderbook') {
    const pair = new URLSearchParams(search).get('pair') || '';
    if (!/^[A-Z0-9]{5,12}$/.test(pair)) return null;
    return { kind: 'depth', host: H_LUNO, up: '/api/1/orderbook_top?pair=' + pair };
  }
  // ---- Bittime (API publik gaya Binance; ticker semua pasangan berbobot 40, jadi cache 15 dtk) ----
  if (pathname === '/bittime/exchangeinfo') return { kind: 'markets', host: H_BITTIME, up: '/api/v1/exchangeInfo' };
  if (pathname === '/bittime/tickers') return { kind: 'tickers15', host: H_BITTIME, up: '/api/v1/ticker/24hr' };
  if (pathname === '/bittime/depth') {
    const q = new URLSearchParams(search), symbol = q.get('symbol') || '', limit = q.get('limit') || '10';
    if (!/^[A-Z0-9]{4,20}$/.test(symbol) || !/^(5|10|20)$/.test(limit)) return null;
    return { kind: 'depth', host: H_BITTIME, up: `/api/v1/depth?symbol=${symbol}&limit=${limit}` };
  }
  // ---- Upbit Indonesia (API kuotasi publik, host regional Indonesia) ----
  if (pathname === '/upbit/markets') return { kind: 'markets', host: H_UPBIT, up: '/v1/market/all' };
  if (pathname === '/upbit/tickers') {
    const mk = new URLSearchParams(search).get('markets') || '';
    if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}(,[A-Z0-9]{2,10}-[A-Z0-9]{2,10}){0,99}$/.test(mk)) return null;
    return { kind: 'tickers', host: H_UPBIT, up: '/v1/ticker?markets=' + mk };
  }
  if (pathname === '/upbit/orderbook') {
    const mk = new URLSearchParams(search).get('market') || '';
    if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/.test(mk)) return null;
    return { kind: 'depth', host: H_UPBIT, up: '/v1/orderbook?markets=' + mk };
  }
  if (pathname === '/upbit/candles') {
    const q = new URLSearchParams(search), mk = q.get('market') || '', unit = q.get('unit') || '', count = q.get('count') || '60';
    if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/.test(mk) || !/^(15|60|240|day)$/.test(unit)) return null;
    if (!/^\d{1,3}$/.test(count) || +count < 1 || +count > 200) return null;
    return { kind: 'klines', host: H_UPBIT, up: (unit === 'day' ? '/v1/candles/days' : '/v1/candles/minutes/' + unit) + '?market=' + mk + '&count=' + count };
  }
  // ---- Pintu (hanya harga terakhir + persen 24 jam; tanpa order book/grafik) ----
  if (pathname === '/pintu/prices') return { kind: 'tickers15', host: H_PINTU, up: '/v2/trade/price-changes' };
  // ---- Reku (harga semua koin + grafik; order book belum diverifikasi) ----
  if (pathname === '/reku/price') return { kind: 'tickers15', host: H_REKU, up: '/v2/price' };
  if (pathname === '/reku/chart') {
    const q = new URLSearchParams(search), id = q.get('id') || '', f = q.get('f') || '';
    if (!/^\d{1,4}$/.test(id) || !/^(15|60|1440)$/.test(f)) return null;
    return { kind: 'klines', host: H_REKU, up: `/v2/chart?t=2&f=${f}&id=${id}` };
  }
  // ---- BTSE Indonesia (API publik btse.id: ringkasan pasar, order book L2, OHLCV) ----
  if (pathname === '/btse/summary') return { kind: 'tickers15', host: H_BTSE, up: '/spot/api/v3.2/market_summary' };
  if (pathname === '/btse/orderbook') {
    const q = new URLSearchParams(search), sym = q.get('symbol') || '', depth = q.get('depth') || '10';
    if (!/^[A-Z0-9]{2,12}-(IDR|USDT)$/.test(sym) || !/^(5|10|20)$/.test(depth)) return null;
    return { kind: 'depth', host: H_BTSE, up: `/spot/api/v3.2/orderbook/L2?symbol=${sym}&depth=${depth}` };
  }
  if (pathname === '/btse/ohlcv') {
    const q = new URLSearchParams(search), sym = q.get('symbol') || '', res = q.get('resolution') || '';
    if (!/^[A-Z0-9]{2,12}-(IDR|USDT)$/.test(sym) || !/^(15|60|240|1440)$/.test(res)) return null;
    return { kind: 'klines', host: H_BTSE, up: `/spot/api/v3.2/ohlcv?symbol=${sym}&resolution=${res}` };
  }
  // ---- Tokocrypto (API publik gaya Binance) ----
  if (pathname === '/tokocrypto/symbols') return { kind: 'markets', host: H_TOKO, up: '/open/v1/common/symbols' };
  if (pathname === '/tokocrypto/depth') {
    const q = new URLSearchParams(search), symbol = q.get('symbol') || '', limit = q.get('limit') || '10';
    if (!/^[A-Z0-9]{4,20}$/.test(symbol) || !/^(5|10|20)$/.test(limit)) return null;
    return { kind: 'depth', host: H_TOKO_MKT, up: `/api/v3/depth?symbol=${symbol}&limit=${limit}` };
  }
  if (pathname === '/tokocrypto/klines') {
    const q = new URLSearchParams(search), symbol = q.get('symbol') || '', iv = q.get('interval') || '', limit = q.get('limit') || '60';
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) return null;
    if (!/^(15m|1h|4h|1d)$/.test(iv)) return null;
    if (!/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 200) return null;
    return { kind: 'klines', host: H_TOKO_MKT, up: `/api/v3/klines?symbol=${symbol}&interval=${iv}&limit=${limit}` };
  }
  return null;
}

function fetchUpstream(host, upPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: host, path: upPath, method: 'GET', timeout: 8000,
      headers: { 'User-Agent': 'IndocoinProxy/1.0', 'Accept': 'application/json' }
    }, r => {
      let buf = [];
      let size = 0;
      r.on('data', c => { size += c.length; if (size > 5e6) { req.destroy(); reject(new Error('too big')); } else buf.push(c); });
      r.on('end', () => {
        const body = Buffer.concat(buf).toString('utf8');
        if (r.statusCode !== 200) return reject(new Error('upstream ' + r.statusCode));
        try { JSON.parse(body); } catch (e) { return reject(new Error('bad json')); }
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function getData(rt) {
  const key = rt.host + rt.up;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.ts < TTL[rt.kind]) return { body: hit.body, stale: false };
  if (!inflight.has(key)) {
    const p = fetchUpstream(rt.host, rt.up).then(body => {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(key, { body, ts: Date.now() });
      return body;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    return { body: await inflight.get(key), stale: false };
  } catch (e) {
    if (hit && now - hit.ts < MAX_STALE) return { body: hit.body, stale: true };
    throw e;
  }
}

function cors(req, res) {
  const o = req.headers.origin;
  if (o && ALLOW_ORIGINS.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: 'indodax-proxy', upstreams: ['indodax','luno','tokocrypto','bittime','upbit','pintu','reku','btse'], port: PORT, cache: cache.size }));
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const rt = route(u.pathname, u.search);
  if (!rt) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not found"}'); }
  try {
    const d = await getData(rt);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Stale': d.stale ? '1' : '0' });
    res.end(d.body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream', msg: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('[indodax-proxy] port ' + PORT));
process.on('uncaughtException', e => console.error('[indodax-proxy] uncaught', e.message));
process.on('unhandledRejection', e => console.error('[indodax-proxy] unhandled', e && e.message));
