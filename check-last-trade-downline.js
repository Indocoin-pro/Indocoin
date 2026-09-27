// Cek TOPUP/TRADE TERAKHIR di INDC Market: siapa wallet-nya, sudah
// terdaftar di ReferralMaster apa belum, dan dia ada di level berapa
// di jaringan downline (10 level) dev wallet.
//
// Jalanin: node check-last-trade-downline.js
const { ethers } = require('ethers');
const https = require('https');

const DEV_WALLET  = '0xa16E9579E19eB19e6E24B211121BdCD7996809Cc';
const MARKET_ADDR = '0xAA488c83Dbf3bDd93543559150a0180AB56BB42E';
const MASTER_ADDR = '0xde257f4C4fe50A650E7D7771ebe43a842CBE35D9';

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

async function main() {
  const provider = await getProvider();
  const market = new ethers.Contract(MARKET_ADDR, MARKET_ABI, provider);
  const master = new ethers.Contract(MASTER_ADDR, MASTER_ABI, provider);

  console.log('Mengambil data trade terakhir dari INDC Market...\n');
  const stats = await market.getMarketStats();
  const totalTrades = stats[7].toString();
  console.log(`Total trade sepanjang sejarah: ${totalTrades}`);

  if (totalTrades == 0) { console.log('Belum ada trade sama sekali.'); return; }

  const lastIdx = Number(totalTrades) - 1;
  const hist = await market.getTradeHistory(lastIdx, 1);
  const last = hist[0];

  const buyer = last.buyer;
  const usdt  = ethers.utils.formatUnits(last.usdtAmount, 18);
  const waktu = new Date(Number(last.timestamp) * 1000).toLocaleString('id-ID');

  console.log('\n=== TRADE TERAKHIR ===');
  console.log(`Wallet   : ${buyer}`);
  console.log(`Nominal  : ${usdt} USDT`);
  console.log(`Waktu    : ${waktu}`);

  console.log('\nMengecek status registrasi di ReferralMaster...');
  const info = await master.getUserInfo(buyer);
  console.log(`Terdaftar: ${info.registered ? 'YA' : 'TIDAK'}`);
  console.log(`Upline   : ${info.upline}`);

  console.log('\nMengecek posisi di jaringan downline dev wallet (level 1-10)...');
  const buyerLower = buyer.toLowerCase();
  let foundLevel = null;
  for (let lvl = 1; lvl <= 10; lvl++) {
    try {
      const url = `https://bot-feed.indocoin.id/api/downline-level?address=${DEV_WALLET}&level=${lvl}`;
      const res = await httpGetJson(url);
      const downlines = (res.downlines || []).map(a => a.toLowerCase());
      if (downlines.includes(buyerLower)) { foundLevel = lvl; break; }
    } catch (e) { console.log(`  (gagal cek level ${lvl}: ${e.message})`); }
  }

  console.log('\n=== HASIL ===');
  if (foundLevel) {
    console.log(`✅ Wallet ini ADA di downline kamu, LEVEL ${foundLevel}.`);
  } else {
    console.log('❌ Wallet ini TIDAK ditemukan di 10 level downline kamu (menurut peta yang sudah dipetakan tree crawler).');
  }
}

main().catch(e => console.error('Error:', e.message));
