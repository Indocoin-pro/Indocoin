// ═══════════════════════════════════════════════════════════
// sync-bonus-welcome.js
// Dijalankan di VPS lewat cron, BUKAN dipicu member buka halaman.
// Tugasnya: sekali jalan, hitung bonus USDT dari Welcome untuk
// SEMUA member sekaligus (bukan satu-satu per wallet), simpan
// hasilnya ke Firebase. referral.html tinggal MEMBACA angka ini,
// tidak pernah menghitung apa pun sendiri lagi — makanya instan.
//
// Cara jalanin manual (buat tes):
//   node sync-bonus-welcome.js
//
// Cara jadwalin otomatis tiap 30 menit (edit crontab: crontab -e):
//   */30 * * * * /usr/bin/node /path/lengkap/ke/sync-bonus-welcome.js >> /var/log/sync-bonus.log 2>&1
// ═══════════════════════════════════════════════════════════

const WELCOME_CA = '0xE96A96fbf0DbF778Ce142aEae47254E94c440903';
const USDT_CA    = '0x55d398326f99059fF775485246999027B3197955';
const BLOK_AWAL_WELCOME = 102364030; // blok saat kontrak Welcome dibuat

const MEGANODE_API_KEY = 'bd4b2496c62445c2ba00a207672952d8';
const MEGANODE_URL = 'https://bsc-mainnet.nodereal.io/v1/' + MEGANODE_API_KEY;

const FIREBASE_DB_URL = 'https://indocoin-network-default-rtdb.asia-southeast1.firebasedatabase.app';

const MAKS_RENTANG_BLOK = 99999; // batas MegaNode: maksimal 100.000 blok per panggilan
const BATAS_HALAMAN = 20;        // pengaman: maksimal 20 halaman (20.000 transfer) per potongan blok

// ── Util kecil ──────────────────────────────────────────────

async function fetchJSON(url, opsi) {
  const res = await fetch(url, opsi);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' dari ' + url);
  return res.json();
}

async function panggilMegaNode(method, params) {
  const json = await fetchJSON(MEGANODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });
  if (json.error) throw new Error('MegaNode ' + method + ': ' + (json.error.message || JSON.stringify(json.error)));
  return json.result;
}

async function ambilBlokTerbaru() {
  const hex = await panggilMegaNode('eth_blockNumber', []);
  return parseInt(hex, 16);
}

// Ambil SEMUA transfer USDT keluar dari kontrak Welcome (ke siapa saja),
// dalam rentang blok tertentu. Tidak difilter per wallet — satu scan
// mencakup semua member sekaligus.
async function ambilSemuaTransferWelcome(fromBlock, toBlock) {
  let semuaTransfer = [];
  let awal = fromBlock;

  while (awal <= toBlock) {
    const akhir = Math.min(awal + MAKS_RENTANG_BLOK, toBlock);
    let pageKey = null;
    let jumlahHalaman = 0;

    do {
      const params = {
        category: ['20'],
        fromBlock: '0x' + awal.toString(16),
        toBlock: '0x' + akhir.toString(16),
        fromAddress: WELCOME_CA,
        contractAddresses: [USDT_CA],
        order: 'asc',
        maxCount: '0x3e8' // 1000
      };
      if (pageKey) params.pageKey = pageKey;

      const hasil = await panggilMegaNode('nr_getAssetTransfers', [params]);
      const jumlahHalIni = (hasil && Array.isArray(hasil.transfers)) ? hasil.transfers.length : 0;
      if (jumlahHalIni > 0) semuaTransfer = semuaTransfer.concat(hasil.transfers);
      jumlahHalaman++;

      if (!hasil || !hasil.pageKey || jumlahHalIni < 1000 || jumlahHalaman >= BATAS_HALAMAN) {
        if (jumlahHalaman >= BATAS_HALAMAN) {
          console.warn('  ⚠ Batas halaman tercapai di blok', awal, '-', akhir, '— kemungkinan ada transfer terlewat');
        }
        pageKey = null;
      } else {
        pageKey = hasil.pageKey;
      }
    } while (pageKey);

    console.log('  Blok', awal, '-', akhir, ':', semuaTransfer.length, 'transfer terkumpul sejauh ini');
    awal = akhir + 1;
  }
  return semuaTransfer;
}

// ── Firebase REST (tanpa perlu service account, pakai rules publik yang sama seperti frontend) ──

async function fbGet(path) {
  const json = await fetchJSON(FIREBASE_DB_URL + '/' + path + '.json');
  return json;
}

async function fbPut(path, data) {
  await fetchJSON(FIREBASE_DB_URL + '/' + path + '.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

// ── Proses utama ─────────────────────────────────────────────

async function main() {
  console.log('=== Sync Bonus Welcome — mulai', new Date().toISOString(), '===');

  const meta = await fbGet('referralBonusMeta');
  const lastScanned = (meta && meta.lastBlockScanned) ? meta.lastBlockScanned : (BLOK_AWAL_WELCOME - 1);
  const latestBlock = await ambilBlokTerbaru();

  console.log('Terakhir discan sampai blok:', lastScanned);
  console.log('Blok terbaru saat ini      :', latestBlock);

  if (lastScanned >= latestBlock) {
    console.log('Tidak ada blok baru untuk discan. Selesai.');
    return;
  }

  const transfers = await ambilSemuaTransferWelcome(lastScanned + 1, latestBlock);
  console.log('Total transfer baru ditemukan:', transfers.length);

  // Jumlahkan per wallet penerima
  const deltaPerWallet = {}; // { walletLowercase: BigInt }
  for (const tr of transfers) {
    const to = tr.to.toLowerCase();
    const nilai = BigInt(tr.value);
    deltaPerWallet[to] = (deltaPerWallet[to] || 0n) + nilai;
  }

  const daftarWallet = Object.keys(deltaPerWallet);
  console.log('Jumlah wallet yang mendapat bonus baru:', daftarWallet.length);

  // Update tiap wallet: ambil total lama, tambah delta, simpan lagi
  for (const wallet of daftarWallet) {
    const existing = await fbGet('referralBonus/' + wallet);
    const totalLama = BigInt((existing && existing.totalWei) ? existing.totalWei : '0');
    const totalBaru = totalLama + deltaPerWallet[wallet];

    await fbPut('referralBonus/' + wallet, {
      totalWei: totalBaru.toString(),
      updatedAt: Date.now()
    });
    console.log('  ✓', wallet, ': +', deltaPerWallet[wallet].toString(), 'wei USDT');
  }

  // Simpan titik terakhir yang berhasil discan
  await fbPut('referralBonusMeta', {
    lastBlockScanned: latestBlock,
    lastRunAt: Date.now()
  });

  console.log('=== Selesai. Tersimpan sampai blok', latestBlock, '===');
}

main().catch(err => {
  console.error('GAGAL:', err);
  process.exit(1);
});
