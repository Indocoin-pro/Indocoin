// Cek LANGSUNG ke blockchain (bukan pakai cache/peta) — telusurin upline
// satu-satu dari wallet yang dicurigai, ke atas, sampai ketemu DEV_WALLET
// atau mentok. Ini lebih pasti daripada peta downline yang di-crawl
// tiap 15 menit (bisa aja belum sempat nangkep yang baru daftar).
//
// Jalanin: node check-upline-chain.js
const { ethers } = require('ethers');

const DEV_WALLET = '0xa16E9579E19eB19e6E24B211121BdCD7996809Cc'.toLowerCase();
const MASTER_ADDR = '0xde257f4C4fe50A650E7D7771ebe43a842CBE35D9';
const MASTER_ABI = [
  'function getUserInfo(address _user) view returns (bool registered, address upline, uint256 joinTime, uint256 totalRefBonus, uint256 totalDownlineCount, uint8[] programs)'
];
const ZERO = '0x0000000000000000000000000000000000000000';

// ISI DI SINI wallet-wallet yang mau dicek
const WALLETS_TO_CHECK = [
  '0x63D24cA6AC842c3a80Da6264d54880C443958D04', // topup $10 (10:13) + $4 (11:36)
  '0xd79134407E39195A31A77eb7cB9b760ED78e06af', // topup 7.96 (11:00) + $3 (11:39)
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

async function traceUpline(master, wallet) {
  const chain = [];
  let current = wallet;
  for (let level = 1; level <= 15; level++) { // guard 15, biar kalau ada siklus aneh gak infinite
    const info = await master.getUserInfo(current);
    if (!info.registered) {
      chain.push({ level, address: current, registered: false, upline: null });
      break;
    }
    const upline = info.upline;
    chain.push({ level, address: current, registered: true, upline });
    if (upline.toLowerCase() === ZERO) break; // sampai akar, gak ada upline lagi
    if (upline.toLowerCase() === DEV_WALLET) {
      chain.push({ level: level + 1, address: upline, registered: true, upline: null, isDev: true });
      break;
    }
    current = upline;
  }
  return chain;
}

async function main() {
  const provider = await getProvider();
  const master = new ethers.Contract(MASTER_ADDR, MASTER_ABI, provider);

  for (const wallet of WALLETS_TO_CHECK) {
    console.log(`\n=== ${wallet} ===`);
    const chain = await traceUpline(master, wallet);

    let foundDev = false;
    chain.forEach((c, idx) => {
      if (c.isDev) {
        console.log(`  [+${idx}] ${c.address}  <-- INI WALLET DEV (ketemu!)`);
        foundDev = true;
      } else if (!c.registered) {
        console.log(`  [${idx}] ${c.address}  -- TIDAK TERDAFTAR (upline chain berhenti di sini)`);
      } else {
        console.log(`  [${idx}] ${c.address}  -> upline: ${c.upline}`);
      }
    });

    if (foundDev) {
      // level downline = jumlah hop dari wallet asal ke dev wallet
      const distance = chain.findIndex(c => c.isDev);
      console.log(`  ✅ HASIL: wallet ini downline kamu, LEVEL ${distance}`);
    } else {
      console.log(`  ❌ HASIL: wallet ini BUKAN downline kamu (rantai upline gak nyambung ke dev wallet dalam 15 hop).`);
    }
  }
}

main().catch(e => console.error('Error:', e.message));
