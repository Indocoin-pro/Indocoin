// Bandingkan getUserPrograms() dari MASTER contract (1 RPC call) vs hasil cek
// 11 kontrak satu-satu yang sudah tersimpan di program-cache.json. Kalau
// hasilnya SAMA, kita bisa ganti ke cara yang jauh lebih simpel & instan.
//
// Jalanin dari dalam folder /root/indocoin (biar nemu node_modules/ethers):
//   cd /root/indocoin
//   node test-master-programs.js
const { ethers } = require('ethers');
const fs = require('fs');

const MASTER_CA = "0xde257f4C4fe50A650E7D7771ebe43a842CBE35D9";
const ABI = ["function getUserPrograms(address _user) view returns (uint8[])"];
const PROGRAM_NAMES = {0:"Welcome",1:"Growth Lock",2:"Dynamic Level",3:"Flexi Yield",4:"Boost Level",5:"Locked Diamond",6:"Auto Compound",7:"Referral Power",8:"Garuda Force",9:"Point Vault",10:"STAKE WIN"};

const RPC_LIST = [
  "https://bsc-dataseed1.binance.org/",
  "https://bsc-dataseed2.binance.org/",
  "https://rpc.ankr.com/bsc",
  "https://bsc.publicnode.com"
];

async function getProvider() {
  for (const rpc of RPC_LIST) {
    try {
      const p = new ethers.providers.JsonRpcProvider(rpc);
      await p.getBlockNumber();
      return p;
    } catch(e) { continue; }
  }
  throw new Error("semua RPC gagal");
}

async function main() {
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync('/root/indocoin/program-cache.json', 'utf-8'));
  } catch(e) {
    console.log("Belum bisa baca program-cache.json — pastikan sudah dijalankan dari /root/indocoin dan file-nya ada.");
    return;
  }

  const entries = Object.entries(cache);
  const activeSample = entries.filter(([a,v]) => v.list && v.list.length > 0).slice(0, 10);
  const emptySample  = entries.filter(([a,v]) => v.list && v.list.length === 0).slice(0, 10);
  const sample = [...activeSample, ...emptySample];

  if (sample.length === 0) {
    console.log("program-cache.json masih kosong (baru direset?) — tunggu beberapa menit lagi baru jalanin script ini.");
    return;
  }

  const provider = await getProvider();
  const c = new ethers.Contract(MASTER_CA, ABI, provider);

  console.log(`Membandingkan ${sample.length} wallet...\n`);
  let match = 0, mismatch = 0;
  for (const [addr, cached] of sample) {
    let masterPrograms = [];
    try {
      const raw = await c.getUserPrograms(addr);
      masterPrograms = raw.map(id => PROGRAM_NAMES[id] || ('Program '+id));
    } catch(e) {
      masterPrograms = ['ERROR: ' + e.message];
    }
    const cachedList = cached.list || [];
    const masterSet = new Set(masterPrograms);
    const same = cachedList.length === masterPrograms.length && cachedList.every(p => masterSet.has(p));
    if (same) match++; else mismatch++;
    console.log(addr);
    console.log(`  Cek 11-kontrak (lama) : [${cachedList.join(', ')}]`);
    console.log(`  Master getUserPrograms: [${masterPrograms.join(', ')}]`);
    console.log(`  ${same ? 'SAMA' : 'BEDA'}\n`);
  }
  console.log(`Hasil: ${match} sama, ${mismatch} beda dari ${sample.length} sample.`);
}

main().catch(e => console.error("Error:", e.message));
