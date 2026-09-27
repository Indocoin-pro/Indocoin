// Nyisir beberapa TRADE TERAKHIR di INDC Market (dari jam 10:00 hari ini),
// cocokin tiap wallet-nya ke jaringan downline (10 level) dev wallet, dan
// totalin USDT dari yang keliatan sebagai downline.
//
// Jalanin: node check-recent-trades.js
const { ethers } = require('ethers');
const https = require('https');

const DEV_WALLET  = '0xa16E9579E19eB19e6E24B211121BdCD7996809Cc';
const MARKET_ADDR = '0xAA488c83Dbf3bDd93543559150a0180AB56BB42E';
const MASTER_ADDR = '0xde257f4C4fe50A650E7D7771ebe43a842CBE35D9';

// Berapa banyak trade terakhir yang mau disisir (naikkan kalau jam 10:00
// ternyata belum kecakup)
const SCAN_COUNT = 60;

const MARKET_ABI = [
  'function getMarketStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256)',
  'function getTradeHistory(uint256,uint256) view returns (tuple(address buyer,uint256 indcAmount,uint256 usdtAmount,uint256 price,uint256 timestamp)[])'
];
const MASTER_ABI = [
  'function getUserInfo(address _user) view returns (bool registered, address upline, uint256 joinTime, uint256 totalRefBonus, uint256 totalDownlineCount, uint8[] programs)'
];

const RPC_LIST = [
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
  'https://rpc.ankr.com/bsc',
  'https://bsc.publicnode.com'
];

async function getProvider() {
  for (const rpc of RPC_LIST) {
    try {
      const p = new ethers.providers.JsonRpcProvider(rpc);
      await p.getBlockNumber();
      return p;
    } catch (e) { continue; }
  }
  throw new Error('Semua RPC gagal dihubungi');
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Ambil peta downline SEKALI di awal (bukan per-trade), biar hemat, lalu
// dipakai buat cek semua trade
async function loadDownlineSet() {
  const set = new Set();
  const perLevel = {};
  for (let lvl = 1; lvl <= 10; lvl++) {
    try {
      const url = `https://bot-feed.indocoin.id/api/downline-level?address=${DEV_WALLET}&level=${lvl}`;
      const res = await httpGetJson(url);
      const downlines = (res.downlines || []).map(a => a.toLowerCase());
      perLevel[lvl] = downlines;
      downlines.forEach(a => set.add(a));
    } catch (e) {
      console.log(`  (gagal ambil level ${lvl}: ${e.message})`);
      perLevel[lvl] = [];
    }
  }
  return { set, perLevel };
}

function findLevel(perLevel, addrLower) {
  for (let lvl = 1; lvl <= 10; lvl++) {
    if (perLevel[lvl].includes(addrLower)) return lvl;
  }
  return null;
}

async function main() {
  const provider = await getProvider();
  const market = new ethers.Contract(MARKET_ADDR, MARKET_ABI, provider);
  const master = new ethers.Contract(MASTER_ADDR, MASTER_ABI, provider);

  console.log('Memuat peta downline kamu (level 1-10)...');
  const { perLevel } = await loadDownlineSet();
  console.log('Peta downline siap.\n');

  console.log('Mengambil data trade dari INDC Market...');
  const stats = await market.getMarketStats();
  const totalTrades = Number(stats[7].toString());
  console.log(`Total trade sepanjang sejarah: ${totalTrades}`);

  const count = Math.min(SCAN_COUNT, totalTrades);
  const fromIdx = totalTrades - count;
  const hist = await market.getTradeHistory(fromIdx, count);

  // Filter dari jam 10:00 WIB hari ini
  const now = new Date();
  const jam10 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0);
  const jam10Unix = Math.floor(jam10.getTime() / 1000);

  console.log(`\nMenyisir ${hist.length} trade terakhir, filter mulai jam ${jam10.toLocaleTimeString('id-ID')} hari ini...\n`);

  let totalDownlineUsdt = 0;
  let matchCount = 0;

  for (const t of hist) {
    const ts = Number(t.timestamp);
    if (ts < jam10Unix) continue; // di luar rentang waktu yang diminta

    const buyerLower = t.buyer.toLowerCase();
    const lvl = findLevel(perLevel, buyerLower);
    const usdt = ethers.utils.formatUnits(t.usdtAmount, 18);
    const waktu = new Date(ts * 1000).toLocaleTimeString('id-ID');

    if (lvl) {
      matchCount++;
      totalDownlineUsdt += parseFloat(usdt);
      console.log(`✅ [${waktu}] ${t.buyer} — ${usdt} USDT — LEVEL ${lvl} (downline kamu)`);
    } else {
      console.log(`   [${waktu}] ${t.buyer} — ${usdt} USDT — bukan downline kamu`);
    }
  }

  console.log('\n=== RINGKASAN ===');
  console.log(`Trade dari downline kamu (sejak jam 10:00): ${matchCount}`);
  console.log(`Total USDT dari downline kamu             : ${totalDownlineUsdt.toFixed(2)} USDT`);

  if (matchCount > 0) {
    console.log('\nMengecek status registrasi wallet downline yang match...');
    const hist2 = hist.filter(t => {
      const ts = Number(t.timestamp);
      return ts >= jam10Unix && findLevel(perLevel, t.buyer.toLowerCase());
    });
    for (const t of hist2) {
      const info = await master.getUserInfo(t.buyer);
      console.log(`  ${t.buyer} → terdaftar: ${info.registered ? 'YA' : 'TIDAK'}, upline: ${info.upline}`);
    }
  }
}

main().catch(e => console.error('Error:', e.message));
