/**
 * INDOCOIN Sniper Bot — API Server v1.0
 * Port: 3002 (via Cloudflare Tunnel → sniper.indocoin.id)
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { getStats, loadConfig } = require('./sniper-bot');

const CONFIG_PATH = path.join(__dirname, 'sniper-config.json');
const SECRET      = process.env.SNIPER_API_SECRET || 'INDOCOIN_SNIPER_2026';

function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type'                : 'application/json',
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function authCheck(req) {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${SECRET}`;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch(e) { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin' : '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const url = req.url.split('?')[0];

  // ── GET /stats ── statistik bot
  if (req.method === 'GET' && url === '/stats') {
    try {
      return sendJSON(res, { ok: true, data: getStats() });
    } catch(e) {
      return sendJSON(res, { ok: false, error: e.message }, 500);
    }
  }

  // ── GET /config ── baca config
  if (req.method === 'GET' && url === '/config') {
    if (!authCheck(req)) return sendJSON(res, { ok: false, error: 'Unauthorized' }, 401);
    try {
      const config = loadConfig();
      return sendJSON(res, { ok: true, data: config });
    } catch(e) {
      return sendJSON(res, { ok: false, error: e.message }, 500);
    }
  }

  // ── POST /config ── update config
  if (req.method === 'POST' && url === '/config') {
    if (!authCheck(req)) return sendJSON(res, { ok: false, error: 'Unauthorized' }, 401);
    try {
      const body   = await parseBody(req);
      const config = loadConfig();
      // Merge config (deep merge level 1)
      for (const key of Object.keys(body)) {
        if (typeof body[key] === 'object' && !Array.isArray(body[key])) {
          config[key] = { ...config[key], ...body[key] };
        } else {
          config[key] = body[key];
        }
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      return sendJSON(res, { ok: true, message: 'Config updated', data: config });
    } catch(e) {
      return sendJSON(res, { ok: false, error: e.message }, 500);
    }
  }

  // ── POST /toggle ── aktif/nonaktif bot
  if (req.method === 'POST' && url === '/toggle') {
    if (!authCheck(req)) return sendJSON(res, { ok: false, error: 'Unauthorized' }, 401);
    try {
      const config  = loadConfig();
      config.bot.aktif = !config.bot.aktif;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      return sendJSON(res, { ok: true, aktif: config.bot.aktif });
    } catch(e) {
      return sendJSON(res, { ok: false, error: e.message }, 500);
    }
  }

  // ── POST /blacklist ── tambah token ke blacklist
  if (req.method === 'POST' && url === '/blacklist') {
    if (!authCheck(req)) return sendJSON(res, { ok: false, error: 'Unauthorized' }, 401);
    try {
      const body   = await parseBody(req);
      const config = loadConfig();
      if (body.token && !config.filter.blacklistToken.includes(body.token)) {
        config.filter.blacklistToken.push(body.token);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      }
      return sendJSON(res, { ok: true, blacklist: config.filter.blacklistToken });
    } catch(e) {
      return sendJSON(res, { ok: false, error: e.message }, 500);
    }
  }

  // ── GET /log ── baca log terbaru
  if (req.method === 'GET' && url === '/log') {
    if (!authCheck(req)) return sendJSON(res, { ok: false, error: 'Unauthorized' }, 401);
    try {
      const logPath = path.join(__dirname, 'sniper-log.txt');
      if (!fs.existsSync(logPath)) return sendJSON(res, { ok: true, log: [] });
      const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
      return sendJSON(res, { ok: true, log: lines.slice(-100) });
    } catch(e) {
      return sendJSON(res, { ok: false, error: e.message }, 500);
    }
  }

  // ── GET /health ── cek server hidup
  if (req.method === 'GET' && url === '/health') {
    return sendJSON(res, { ok: true, message: 'Sniper Bot Online', time: new Date().toISOString() });
  }

  sendJSON(res, { ok: false, error: 'Not found' }, 404);
});

const PORT = parseInt(process.env.SNIPER_PORT || '3002');
server.listen(PORT, () => {
  console.log(`[Sniper API] Server running on port ${PORT}`);
});
