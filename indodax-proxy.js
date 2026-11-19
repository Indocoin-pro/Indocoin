// ═══════════════════════════════════════════════════════════════
//  INDOCOIN — Indodax Public Proxy (service mandiri, port 3010)
//  Tidak menyentuh server.js (Elara) maupun service lain.
//  Hanya meneruskan 4 endpoint data PUBLIK Indodax + cache singkat.
//  Tidak ada API key, tidak ada dana yang lewat.
//
//  Jalur (cermin path Indodax, diawali /indodax):
//    GET /indodax/api/pairs
//    GET /indodax/api/summaries
//    GET /indodax/api/depth/{pairId}
//    GET /indodax/tradingview/history_v2?symbol&tf&from&to
//    GET /health
// ═══════════════════════════════════════════════════════════════
const http  = require('http');
const https = require('https');

const PORT = parseInt(process.env.INDODAX_PROXY_PORT || '3010', 10);
const UPSTREAM = 'indodax.com';
const ALLOW_ORIGINS = ['https://indocoin.id', 'https://www.indocoin.id'];

// TTL cache (ms) per jenis endpoint
const TTL = { pairs: 300000, summaries: 5000, depth: 3000, history: 30000 };
const MAX_STALE = 10 * 60 * 1000;   // data lama masih boleh dipakai saat Indodax error
const MAX_CACHE = 600;              // batas jumlah entri cache

const cache = new Map();            // key -> { body, ts }
const inflight = new Map();         // key -> Promise (gabungkan permintaan sama)

function route(pathname, search) {
  if (pathname === '/indodax/api/pairs')     return { kind: 'pairs',     up: '/api/pairs' };
  if (pathname === '/indodax/api/summaries') return { kind: 'summaries', up: '/api/summaries' };
  let m = /^\/indodax\/api\/depth\/([a-z0-9_]{2,30})$/.exec(pathname);
  if (m) return { kind: 'depth', up: '/api/depth/' + m[1] };
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
    return { kind: 'history', up: `/tradingview/history_v2?from=${f}&to=${t}&tf=${tf}&symbol=${symbol}` };
  }
  return null;
}

function fetchUpstream(upPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: UPSTREAM, path: upPath, method: 'GET', timeout: 8000,
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
  const key = rt.up;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.ts < TTL[rt.kind]) return { body: hit.body, stale: false };
  if (!inflight.has(key)) {
    const p = fetchUpstream(rt.up).then(body => {
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
    return res.end(JSON.stringify({ status: 'ok', service: 'indodax-proxy', port: PORT, cache: cache.size }));
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
