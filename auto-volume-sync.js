// ============================================================
//  INDOCOIN — AUTO VOLUME SYNC
// ------------------------------------------------------------
//  Tujuan:
//  - Scan event Staked baru dari Welcome V2
//  - Untuk setiap user, cek selisih antara total staking
//    (Welcome V2) vs Aggregator.getUserVolume(user)
//  - Kalau ada selisih, panggil reportVolumeUSDT(user, selisih, 2)
//    menggunakan DEV WALLET (approved program di Aggregator)
//
//  PENTING:
//  - Private key dev wallet HARUS di .env (DEV_PRIVATE_KEY)
//  - JANGAN commit .env ke git
//  - Script ini TIDAK menyentuh server.js / LiteSpeed
// ============================================================

require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────
const RPC_URL         = process.env.RPC_URL || 'https://bsc-dataseed1.binance.org/';
const DEV_PRIVATE_KEY = process.env.DEV_PRIVATE_KEY;
const INTERVAL_MIN    = parseInt(process.env.SYNC_INTERVAL_MIN || '15', 10);
const LOOKBACK_BLOCKS = parseInt(process.env.LOOKBACK_BLOCKS || '5000', 10); // ~4-5 jam fallback
const STATE_FILE      = path.join(__dirname, 'sync-state.json');
const LOG_FILE        = path.join(__dirname, 'sync.log');

const WELCOME_ADDR     = '0xE96A96fbf0DbF778Ce142aEae47254E94c440903';
const AGGREGATOR_ADDR  = '0xD4109384EB4086E37265ec71f11e443269bf5110';

const WELCOME_ABI = [
  "event Staked(address indexed user, uint256 indcAmount, uint256 usdtEquivalent, uint256 positionIndex)",
  "function getPositionCount(address user) external view returns (uint256)",
  "function getPosition(address user, uint256 idx) external view returns (uint256 indcStaked, uint256 usdtEquivalent, uint256 startTime, uint256 lastCheckpoint, uint256 reward, bool active, bool checkpointPending, uint256 nextCheckpointTime)"
];
const AGGREGATOR_ABI = [
  "function getUserVolume(address user) external view returns (uint256)",
  "function reportVolumeUSDT(address user, uint256 usdtAmount, uint8 activityType) external"
];

// ── Helpers ─────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return { lastBlock: 0 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Main sync logic ─────────────────────────────────────────
async function runSync() {
  if (!DEV_PRIVATE_KEY) {
    log('❌ DEV_PRIVATE_KEY tidak ditemukan di .env — sync dibatalkan.');
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(DEV_PRIVATE_KEY, provider);

  const welcome = new ethers.Contract(WELCOME_ADDR, WELCOME_ABI, provider);
  const agg      = new ethers.Contract(AGGREGATOR_ADDR, AGGREGATOR_ABI, wallet);

  const state = loadState();
  const latestBlock = await provider.getBlockNumber();
  let fromBlock = state.lastBlock > 0 ? state.lastBlock + 1 : Math.max(0, latestBlock - LOOKBACK_BLOCKS);

  if (fromBlock > latestBlock) {
    log('Tidak ada block baru.');
    return;
  }

  log(`Scan block ${fromBlock} → ${latestBlock}...`);

  // Scan dalam chunk kecil untuk hindari limit RPC
  const CHUNK = 2000;
  let allEvents = [];
  let start = fromBlock;
  while (start <= latestBlock) {
    const end = Math.min(start + CHUNK, latestBlock);
    try {
      const events = await welcome.queryFilter(welcome.filters.Staked(), start, end);
      allEvents = allEvents.concat(events);
    } catch (e) {
      log(`⚠️ Gagal scan block ${start}-${end}: ${e.message}`);
    }
    start = end + 1;
  }

  log(`Ditemukan ${allEvents.length} event Staked baru.`);

  // Kumpulkan user unik
  const users = [...new Set(allEvents.map(ev => ev.args.user))];

  let syncedCount = 0;
  for (const user of users) {
    try {
      // Hitung total staking user dari Welcome V2
      let total = ethers.BigNumber.from(0);
      const count = await welcome.getPositionCount(user);
      for (let i = 0; i < count; i++) {
        const pos = await welcome.getPosition(user, i);
        total = total.add(pos.usdtEquivalent);
      }

      // Cek volume yang sudah tercatat di Aggregator
      const currentVol = await agg.getUserVolume(user);

      if (total.gt(currentVol)) {
        const diff = total.sub(currentVol);
        log(`Sync ${user}: total=$${ethers.utils.formatUnits(total, 18)}, sudah=$${ethers.utils.formatUnits(currentVol, 18)}, selisih=$${ethers.utils.formatUnits(diff, 18)}`);

        const tx = await agg.reportVolumeUSDT(user, diff, 2);
        await tx.wait();
        log(`✅ Sukses sync ${user} — tx: ${tx.hash}`);
        syncedCount++;

        // Delay kecil antar tx untuk hindari nonce/gas issue
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      log(`❌ Gagal proses ${user}: ${e.message}`);
    }
  }

  state.lastBlock = latestBlock;
  saveState(state);

  log(`Selesai. ${syncedCount}/${users.length} user disync. lastBlock=${latestBlock}`);
}

// ── Run periodically ────────────────────────────────────────
log(`=== Auto Volume Sync dimulai. Interval: ${INTERVAL_MIN} menit ===`);
runSync().catch(e => log('❌ Error fatal: ' + e.message));

setInterval(() => {
  runSync().catch(e => log('❌ Error fatal: ' + e.message));
}, INTERVAL_MIN * 60 * 1000);
