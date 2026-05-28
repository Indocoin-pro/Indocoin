// ═══════════════════════════════════════════════════════════════
//  INDOCOIN BOT RADAR — Live Feed Service
//  Standalone Node.js server, port 3001
//  TIDAK menyentuh server.js — Elara & harga real-time AMAN
//  
//  Endpoint: GET /api/bot-live-feed
//  Return: JSON dengan log stream, bot status, stats
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const fs   = require('fs');
const { exec } = require('child_process');

const PORT = 3001;
const BOTS = ['arbibot', 'venus', 'triangular', 'stablecoin', 'aave', 'v2v3'];

// Cache 2 detik biar tidak overload disk
let cache = null;
let cacheTime = 0;
const CACHE_MS = 2000;

// ── HELPER: Mask sensitive data ────────────────────────────────
function sanitize(line) {
  if (!line) return '';
  // Filter sensitive
  if (/private|seed|mnemonic|password/i.test(line)) return null;
  if (/⛽\s*BNB:|BNB tidak cukup|injected env/i.test(line)) return null;
  // Mask wallet
  return line.replace(/0x[a-fA-F0-9]{40}/g, m => m.slice(0, 6) + '...' + m.slice(-4));
}

// ── HELPER: Klasifikasi event ──────────────────────────────────
function classify(text) {
  if (/✅|SUCCESS|sukses.*EKSEKUSI/i.test(text)) return 'success';
  if (/❌|REVERT|gagal/i.test(text))             return 'error';
  if (/✨|⚡|peluang|EKSEKUSI|opportunity/i.test(text)) return 'opportunity';
  if (/Scan #|scanning|cek borrower/i.test(text)) return 'scan';
  if (/sehat|healthy|aman/i.test(text))           return 'info';
  return 'log';
}

// ── HELPER: Baca log per bot ───────────────────────────────────
function readBotLog(bot) {
  try {
    const path = `/root/.pm2/logs/${bot}-out.log`;
    if (!fs.existsSync(path)) return [];
    
    const data = fs.readFileSync(path, 'utf-8');
    const lines = data.split('\n').filter(l => l.trim()).slice(-25);
    
    return lines.map(line => {
      const clean = sanitize(line);
      if (!clean) return null;
      return {
        bot: bot.toUpperCase(),
        text: clean.substring(0, 200),
        type: classify(clean),
        ts: Date.now()
      };
    }).filter(Boolean);
  } catch(e) {
    return [];
  }
}

// ── HELPER: Get PM2 status (cpu, memory, uptime) ───────────────
function getPm2Status() {
  return new Promise(resolve => {
    exec('pm2 jlist', { timeout: 2000 }, (err, stdout) => {
      if (err) return resolve({});
      try {
        const list = JSON.parse(stdout);
        const status = {};
        list.forEach(p => {
          if (BOTS.includes(p.name)) {
            status[p.name] = {
              status: p.pm2_env?.status || 'unknown',
              cpu: p.monit?.cpu || 0,
              memory: Math.round((p.monit?.memory || 0) / 1024 / 1024),
              uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
              restarts: p.pm2_env?.restart_time || 0
            };
          }
        });
        resolve(status);
      } catch(e) {
        resolve({});
      }
    });
  });
}

// ── HELPER: Compute stats hari ini ─────────────────────────────
function computeStats(allFeed) {
  let totalScan = 0;
  let totalOpportunity = 0;
  let totalSuccess = 0;
  let totalError = 0;
  
  allFeed.forEach(item => {
    if (item.type === 'scan')        totalScan++;
    if (item.type === 'opportunity') totalOpportunity++;
    if (item.type === 'success')     totalSuccess++;
    if (item.type === 'error')       totalError++;
  });
  
  return { totalScan, totalOpportunity, totalSuccess, totalError };
}

// ── BUILD RESPONSE ─────────────────────────────────────────────
async function buildResponse() {
  // Use cache kalau masih fresh
  if (cache && (Date.now() - cacheTime < CACHE_MS)) {
    return cache;
  }
  
  // Baca semua log bot
  let allFeed = [];
  BOTS.forEach(bot => {
    allFeed = allFeed.concat(readBotLog(bot));
  });
  
  // Sort by latest (ambil 60 terakhir)
  allFeed = allFeed.slice(-60);
  
  // Get PM2 status
  const botStatus = await getPm2Status();
  
  // Compute stats
  const stats = computeStats(allFeed);
  
  cache = {
    feed: allFeed,
    bots: botStatus,
    stats: stats,
    bots_total: BOTS.length,
    bots_running: Object.keys(botStatus).filter(b => botStatus[b].status === 'online').length,
    timestamp: new Date().toISOString(),
    server_time: Date.now()
  };
  cacheTime = Date.now();
  
  return cache;
}

// ── HTTP SERVER ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  
  // Route: /api/bot-live-feed
  if (req.method === 'GET' && req.url.startsWith('/api/bot-live-feed')) {
    try {
      const data = await buildResponse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'feed error', msg: e.message }));
    }
  }
  
  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: 'bot-feed', port: PORT }));
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🛰️  BOT RADAR feed service running on port ${PORT}`);
  console.log(`    Endpoint: http://localhost:${PORT}/api/bot-live-feed`);
  console.log(`    Bots monitored: ${BOTS.join(', ')}`);
});

// Error handling
server.on('error', err => {
  console.error('Server error:', err.message);
  process.exit(1);
});

process.on('uncaughtException', e => {
  console.error('Uncaught:', e.message);
});
