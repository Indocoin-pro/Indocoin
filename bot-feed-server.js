// ═══════════════════════════════════════════════════════════════
//  INDOCOIN BOT RADAR — Live Feed Service
//  Standalone Node.js server, port 3001
//  TIDAK menyentuh server.js — Elara & harga real-time AMAN
//  
//  Endpoint: GET /api/bot-live-feed
//  Return: JSON dengan log stream, bot status, stats
// ═══════════════════════════════════════════════════════════════

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { exec } = require('child_process');
const { ethers } = require('ethers');

const PORT = 3001;
const BOTS = ['arbibot', 'venus', 'triangular', 'stablecoin', 'aave', 'v2v3'];

// ═══════════════════════════════════════════════════════════════
//  MEMBER STATS — numpang di service ini, tidak bikin server baru.
//  Nge-poll totalMembers() dari chain tiap 3 menit di background,
//  browser (referral.html) tinggal ambil angka jadi lewat
//  GET /api/member-stats — jauh lebih cepat dari query on-chain
//  langsung dari tiap HP pengunjung.
// ═══════════════════════════════════════════════════════════════
const MS_CACHE_FILE  = path.join(__dirname, 'member-stats-cache.json');
const MS_REFRESH_MS  = 3 * 60 * 1000; // 3 menit — member baru boleh telat muncul, gapapa
const MS_MASTER_CA   = "0xde257f4C4fe50A650E7D7771ebe43a842CBE35D9";
const MS_BASE_MEMBER = 75;
const MS_BASE_STAKER = 17;
const MS_RPC_LIST = [
  "https://bsc-dataseed1.binance.org/",
  "https://bsc-dataseed2.binance.org/",
  "https://bsc-dataseed3.binance.org/",
  "https://bsc-dataseed4.binance.org/",
  "https://rpc.ankr.com/bsc",
  "https://bsc.publicnode.com",
  "https://bsc-rpc.publicnode.com",
  "https://binance.llamarpc.com"
];
const MS_ABI = [
  {"inputs":[],"name":"totalMembers","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
];

function msLoadCache() {
  try { return JSON.parse(fs.readFileSync(MS_CACHE_FILE, 'utf-8')); }
  catch(e) { return { totalMembers: 0, member: MS_BASE_MEMBER, staker: MS_BASE_STAKER, updatedAt: null }; }
}
function msSaveCache() {
  try { fs.writeFileSync(MS_CACHE_FILE, JSON.stringify(memberStatsCache)); } catch(e) {}
}
let memberStatsCache = msLoadCache();

async function msRefresh() {
  let realCount = null;
  try {
    const attempts = MS_RPC_LIST.map(rpc => (async () => {
      const provider = new ethers.providers.JsonRpcProvider(rpc);
      const c = new ethers.Contract(MS_MASTER_CA, MS_ABI, provider);
      const members = await Promise.race([
        c.totalMembers(),
        new Promise((_, rej) => setTimeout(() => rej('timeout'), 5000))
      ]);
      return parseInt(members.toString());
    })());
    realCount = await Promise.any(attempts);
  } catch(e) { realCount = null; }

  if (realCount !== null) {
    memberStatsCache = {
      totalMembers: realCount,
      member: MS_BASE_MEMBER + realCount,
      staker: MS_BASE_STAKER + realCount,
      updatedAt: new Date().toISOString()
    };
    msSaveCache();
  }
  // Kalau semua RPC gagal: cache lama tetap dipakai, tidak ditimpa.
}
setInterval(msRefresh, MS_REFRESH_MS);
msRefresh();

// ═══════════════════════════════════════════════════════════════
//  PROGRAM CACHE — "program aktif" per wallet downline, pola sama
//  kayak MEMBER STATS di atas. Sebelumnya browser tiap user yang
//  nembak 10 kontrak x sampai 20 wallet sekaligus ke RPC publik →
//  gampang timeout & kebaca salah jadi "tidak aktif". Sekarang
//  server yang ngecek, pelan-pelan, dicicil, dicache per wallet —
//  hasilnya numpuk & DIPAKAI BERSAMA semua pengunjung (bukan per
//  device), jadi makin lama makin banyak yang instan.
// ═══════════════════════════════════════════════════════════════
const PC_CACHE_FILE = path.join(__dirname, 'program-cache.json');
const PC_TTL_MS      = 60 * 60 * 1000; // dianggap "segar" 60 menit sebelum di-refresh diam-diam
const PC_CONCURRENCY = 8;              // maks 8 wallet diproses bersamaan di server (dinaikkan biar catch-up lebih cepat)
const PC_TICK_MS     = 800;            // antar batch, biar RPC gak digebuk

const PC_ABI_HELPERS = {
  GrowthLock: ["function getUserStakes(address user) view returns (tuple(uint8 optionId,uint256 amount,uint256 indcReward,uint256 startTime,uint256 endTime,bool claimed,bool unstaked,bool principalPending)[])"],
  DynamicLevel: ["function getUserStakes(address user) view returns (tuple(uint8 level,uint256 amount,uint256 indcReward,uint256 startTime,bool claimed,bool withdrawn,bool principalPending)[])"],
  FlexiYield: ["function getStakeInfo(address user) view returns(uint256 amount,uint256 startTime,uint256 lastRewardTime,uint256 accruedIndc,uint8 category,uint256 holdRequired,bool active)"],
  BoostLevel: ["function getStakeCount(address) view returns(uint256)"],
  LockedDiamond: ["function getUserActiveTiers(address user) view returns(bool[4])"],
  AutoCompound: ["function getTotalCompoundBalance(address user) view returns(uint256)"],
  ReferralPower: ["function getUserInfo(address userAddr) view returns(bool registered,bool active,address referrer,uint256 principal,uint256 rewardClaimed,uint256 pendingReward,uint256 roiCapRemaining,bool roiCapReached)"],
  GarudaForce: ["function getStakeInfo(address user) view returns(uint256 principal,uint256 startTime,uint256 lastClaimTime,uint256 pendingRewardIndc,uint8 currentTier,string tierLabel,uint256 downlineActive,bool active)"],
  PointVault: ["function getUserStake(address user) view returns(uint256 indcStaked,uint256 usdValue,uint256 pointPerDayEst,uint256 pendingPointNow,bool active)"],
  StakeWin: [
    "function getStakePaketA(address user) view returns(uint256 amount,uint256 since,uint256 reward)",
    "function getStakePaketB(address user) view returns(uint256 amount,uint256 since,uint256 pendingReward)"
  ],
  Welcome: [
    "function getPositionCount(address user) view returns (uint256)",
    "function getPosition(address user, uint256 idx) view returns (uint256 indcStaked, uint256 usdtEquivalent, uint256 startTime, uint256 lastCheckpoint, uint256 reward, bool active, bool checkpointPending, uint256 nextCheckpointTime)"
  ]
};

// Sama persis dengan STAKING_CONTRACTS di referral.html — kalau nambah/ubah
// program di sana, tolong sinkronkan juga di sini.
const PC_PROGRAMS = [
  { name: "Growth Lock", ca: "0xcb9261633af02bec4ceb13be970b0b4d2462c8d5", abi: PC_ABI_HELPERS.GrowthLock,
    check: async (c, addr) => { const s = await c.getUserStakes(addr); return Array.isArray(s) && s.length > 0 && ethers.BigNumber.from(s[0].amount.toString()).gt(0); } },
  { name: "Dynamic Level", ca: "0x51b94ab16165430972236ae62ce93ed4fd9f5ac7", abi: PC_ABI_HELPERS.DynamicLevel,
    check: async (c, addr) => { const s = await c.getUserStakes(addr); return Array.isArray(s) && s.length > 0; } },
  { name: "Flexi Yield", ca: "0xc31ddfd5e703f094ac8af66832a8c1ec3a209952", abi: PC_ABI_HELPERS.FlexiYield,
    check: async (c, addr) => { const s = await c.getStakeInfo(addr); const a = s.active !== undefined ? s.active : s[6]; return a === true; } },
  { name: "Boost Level", ca: "0x0c445da047b9f7702382e0cc7fecdf5f245305ad", abi: PC_ABI_HELPERS.BoostLevel,
    check: async (c, addr) => { const n = await c.getStakeCount(addr); return ethers.BigNumber.from(n.toString()).gt(0); } },
  { name: "Locked Diamond", ca: "0x858cece880f2ab7fdf8602148c61083c4a338373", abi: PC_ABI_HELPERS.LockedDiamond,
    check: async (c, addr) => { const a = await c.getUserActiveTiers(addr); return a[0] || a[1] || a[2] || a[3]; } },
  { name: "Auto Compound", ca: "0x99aAbacb9b57Df83d1539e250b799C6615207616", abi: PC_ABI_HELPERS.AutoCompound,
    check: async (c, addr) => { const n = await c.getTotalCompoundBalance(addr); return ethers.BigNumber.from(n.toString()).gt(0); } },
  { name: "Referral Power", ca: "0xF2FD48D3D5a84ab2b9d76ec2bDe34a5699aE3552", abi: PC_ABI_HELPERS.ReferralPower,
    check: async (c, addr) => { const u = await c.getUserInfo(addr); const r = u.registered !== undefined ? u.registered : u[0]; const a = u.active !== undefined ? u.active : u[1]; return r === true && a === true; } },
  { name: "Garuda Force", ca: "0xdfabc3159c8a195feced77069b8d4fb16deed667", abi: PC_ABI_HELPERS.GarudaForce,
    check: async (c, addr) => { const m = await c.getStakeInfo(addr); const a = m.active !== undefined ? m.active : m[7]; return a === true; } },
  { name: "Point Vault", ca: "0x293AcCBE4AB78Aedc898a36b75eE402Ee52e644c", abi: PC_ABI_HELPERS.PointVault,
    check: async (c, addr) => { const s = await c.getUserStake(addr); const a = s.active !== undefined ? s.active : s[4]; return a === true; } },
  { name: "STAKE WIN", ca: "0x2C00473e14865995f0AcC83dA407d819647Af819", abi: PC_ABI_HELPERS.StakeWin,
    check: async (c, addr) => {
      const [a, b] = await Promise.all([c.getStakePaketA(addr), c.getStakePaketB(addr)]);
      const amtA = ethers.BigNumber.from((a.amount !== undefined ? a.amount : a[0]).toString());
      const amtB = ethers.BigNumber.from((b.amount !== undefined ? b.amount : b[0]).toString());
      return amtA.gt(0) || amtB.gt(0);
    } },
  { name: "Welcome", ca: "0xE96A96fbf0DbF778Ce142aEae47254E94c440903", abi: PC_ABI_HELPERS.Welcome,
    check: async (c, addr) => {
      const count = await c.getPositionCount(addr);
      const n = parseInt(count.toString());
      if (n === 0) return false;
      for (let i = 0; i < n; i++) {
        const pos = await c.getPosition(addr, i);
        const a = pos.active !== undefined ? pos.active : pos[5];
        if (a === true) return true;
      }
      return false;
    } }
];

function pcLoadCache() {
  try { return JSON.parse(fs.readFileSync(PC_CACHE_FILE, 'utf-8')); }
  catch(e) { return {}; }
}
function pcSaveCache() {
  try { fs.writeFileSync(PC_CACHE_FILE, JSON.stringify(programCache)); } catch(e) {}
}
let programCache = pcLoadCache(); // { [addr_lowercase]: { list: [...], updatedAt } }
const pcQueue = new Set();         // alamat yang lagi antre diproses
const pcInFlight = new Set();      // alamat yang lagi diproses saat ini

function pcIsFresh(addr) {
  const entry = programCache[addr];
  return entry && (Date.now() - new Date(entry.updatedAt).getTime() < PC_TTL_MS);
}

// RPC yang lagi dipakai di-cache biar gak nyari ulang tiap wallet — cuma
// dicek ulang kalau ternyata sudah mati.
let pcCachedProvider = null;
let pcCachedProviderAt = 0;
async function pcGetProvider() {
  if (pcCachedProvider && (Date.now() - pcCachedProviderAt < 60000)) return pcCachedProvider;
  for (const rpc of MS_RPC_LIST) {
    try {
      const p = new ethers.providers.JsonRpcProvider(rpc);
      await Promise.race([p.getBlockNumber(), new Promise((_,rej)=>setTimeout(()=>rej('timeout'),4000))]);
      pcCachedProvider = p;
      pcCachedProviderAt = Date.now();
      return p;
    } catch(e) { continue; }
  }
  pcCachedProvider = null;
  return null;
}

async function pcCheckOneAddress(addr) {
  const provider = await pcGetProvider();
  if (!provider) return; // semua RPC gagal, coba lagi di tick berikutnya

  // 11 kontrak dicek BARENGAN (paralel), bukan satu-satu berurutan.
  // Sebelumnya sequential — itu yang bikin 1 wallet bisa makan puluhan detik.
  // Server ini titik pusat (bukan 200 HP sekaligus kayak dulu di browser),
  // jadi 11 request paralel per wallet aman buat RPC publik.
  const results = await Promise.allSettled(
    PC_PROGRAMS.map(async (prog) => {
      const c = new ethers.Contract(prog.ca, prog.abi, provider);
      const active = await Promise.race([
        prog.check(c, addr),
        new Promise((_,rej)=>setTimeout(()=>rej('timeout'), 6000))
      ]);
      return { name: prog.name, active };
    })
  );

  const list = [];
  let allFailed = true;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allFailed = false;
      if (r.value.active === true) list.push(r.value.name);
    }
  }
  if (allFailed) pcCachedProvider = null; // provider kemungkinan mati, cari ulang di panggilan berikutnya

  programCache[addr] = { list, updatedAt: new Date().toISOString() };
}

// Worker: proses antrean pelan-pelan, PC_CONCURRENCY alamat tiap PC_TICK_MS
let pcSaveCounter = 0;
setInterval(async () => {
  if (pcQueue.size === 0) return;
  const batch = [...pcQueue].filter(a => !pcInFlight.has(a)).slice(0, PC_CONCURRENCY);
  if (batch.length === 0) return;

  batch.forEach(a => { pcQueue.delete(a); pcInFlight.add(a); });
  await Promise.all(batch.map(async (addr) => {
    try { await pcCheckOneAddress(addr); } catch(e) {}
    pcInFlight.delete(addr);
  }));

  pcSaveCounter++;
  if (pcSaveCounter % 3 === 0) pcSaveCache(); // jangan nulis disk tiap tick, cukup tiap 3x
}, PC_TICK_MS);

// ═══════════════════════════════════════════════════════════════
//  TREE CRAWLER — inti dari "cek semua duluan, simpan". Mulai dari
//  wallet paling atas (root), telusuri SEMUA downline turun-temurun
//  pakai getDirectDownlines(), lalu setiap alamat yang ketemu langsung
//  diantrekan ke pcQueue di atas buat dicek program-nya. Jalan sendiri
//  di background tiap 15 menit — TIDAK nunggu ada yang buka halaman.
// ═══════════════════════════════════════════════════════════════
// ISI di sini alamat wallet paling atas jaringan referral (root/genesis),
// huruf kecil semua. Bisa lebih dari satu kalau ada beberapa cabang akar.
const PC_ROOT_ADDRESSES = [
  "0xa16E9579E19eB19e6E24B211121BdCD7996809Cc" // dev wallet — dipakai konsisten di earn.html, welcome.html, ppob-server.js, dll
];

const PC_TREE_FILE = path.join(__dirname, 'member-tree-cache.json');
const PC_CRAWL_INTERVAL_MS = 15 * 60 * 1000;
const MASTER_TREE_ABI = ["function getDirectDownlines(address _user) view returns (address[])"];

function pcLoadKnownAddrs() {
  try { return new Set(JSON.parse(fs.readFileSync(PC_TREE_FILE, 'utf-8'))); }
  catch(e) { return new Set(); }
}
function pcSaveKnownAddrs() {
  try { fs.writeFileSync(PC_TREE_FILE, JSON.stringify([...pcKnownAddrs])); } catch(e) {}
}
let pcKnownAddrs = pcLoadKnownAddrs();

async function pcGetDirectDownlines(addr) {
  const provider = await pcGetProvider();
  if (!provider) return [];
  try {
    const c = new ethers.Contract(MS_MASTER_CA, MASTER_TREE_ABI, provider);
    const list = await Promise.race([
      c.getDirectDownlines(addr),
      new Promise((_,rej)=>setTimeout(()=>rej('timeout'), 6000))
    ]);
    return list.map(a => a.toLowerCase());
  } catch(e) { return []; }
}

// Telusuri pohon downline level demi level (BFS) dari root, kumpulkan SEMUA
// alamat yang pernah ketemu, dan antrekan yang belum pernah dicek program-nya.
async function crawlDownlineTree() {
  if (PC_ROOT_ADDRESSES.length === 0) {
    console.log('⚠️ PC_ROOT_ADDRESSES masih kosong — isi dulu alamat wallet paling atas biar tree crawler jalan.');
    return;
  }
  let frontier = PC_ROOT_ADDRESSES.map(a => a.toLowerCase());
  let newlyFound = 0;
  let depth = 0;
  const BATCH = 5;

  while (frontier.length > 0 && depth < 20) { // guard: maks 20 level kedalaman
    depth++;
    const nextFrontier = [];
    for (let i = 0; i < frontier.length; i += BATCH) {
      const chunk = frontier.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(a => pcGetDirectDownlines(a)));
      for (const downlines of results) {
        for (const d of downlines) {
          if (!pcKnownAddrs.has(d)) {
            pcKnownAddrs.add(d);
            newlyFound++;
          }
          if (!pcIsFresh(d)) pcQueue.add(d); // antrekan buat dicek/refresh program-nya
          nextFrontier.push(d);
        }
      }
      await new Promise(r => setTimeout(r, 300)); // jeda kecil antar batch, hemat RPC
    }
    frontier = nextFrontier;
  }

  if (newlyFound > 0) pcSaveKnownAddrs();
  console.log(`🌳 Tree crawl selesai: ${newlyFound} member baru, total dikenal ${pcKnownAddrs.size}, ${pcQueue.size} diantrekan buat dicek.`);
}

setInterval(crawlDownlineTree, PC_CRAWL_INTERVAL_MS);
crawlDownlineTree(); // langsung mulai begitu servis nyala, gak nunggu ada yang buka halaman

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
  
  // Route: /api/member-programs?addresses=0xabc,0xdef,...
  if (req.method === 'GET' && req.url.startsWith('/api/member-programs')) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const raw = (u.searchParams.get('addresses') || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean).slice(0, 30);
      const data = {};
      for (const addr of raw) {
        if (programCache[addr]) {
          // Sudah pernah kecek → SELALU kasih hasil ini duluan (walau udah
          // lewat 30 menit / "basi"), jangan pernah dibuang jadi null.
          // Kalau basi, diam-diam antrekan buat di-refresh di background —
          // browser tetap dapat data terakhir yang valid, bukan "belum tau".
          data[addr] = programCache[addr];
          if (!pcIsFresh(addr)) pcQueue.add(addr);
        } else {
          data[addr] = null; // beneran belum pernah dicek sama sekali
          pcQueue.add(addr);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'program-stats error', msg: e.message }));
    }
  }

  // Route: /api/member-stats
  if (req.method === 'GET' && req.url.startsWith('/api/member-stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(memberStatsCache));
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
