/**
 * ppob-listener.js
 * ═══════════════════════════════════════════════════════════════
 *  INDOCOIN PPOB — Backend Listener
 * ═══════════════════════════════════════════════════════════════
 *  Proses utama yang menjembatani smart contract PPOBGateway dengan
 *  API Digiflazz. Tugasnya:
 *
 *  1. Dengarkan event OrderCreated dari kontrak
 *  2. Cari nomor tujuan (customerNo) dari database lokal
 *  3. Eksekusi pembelian produk ke Digiflazz
 *  4. Lapor hasil (sukses/gagal) balik ke kontrak
 *
 *  Dijalankan terpisah dari server.js (proses API untuk frontend) —
 *  disarankan jalan sebagai service tersendiri via PM2:
 *      pm2 start ppob-listener.js --name ppob-listener
 *      pm2 start server.js --name ppob-api
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const db = require('./db');
const digiflazz = require('./digiflazz');
const blockchain = require('./blockchain');
const settle = require('./settle');

const LAST_BLOCK_FILE = './.last-processed-block';
const fs = require('fs');

function getLastProcessedBlock() {
  try {
    return parseInt(fs.readFileSync(LAST_BLOCK_FILE, 'utf8'), 10);
  } catch {
    return null;
  }
}

function saveLastProcessedBlock(blockNumber) {
  fs.writeFileSync(LAST_BLOCK_FILE, String(blockNumber));
}

/**
 * Proses 1 order: cari nomor tujuan, eksekusi ke Digiflazz, lapor hasil.
 */
async function handleOrder(order) {
  console.log(`\n[ppob-listener] Order baru terdeteksi: ${order.orderId}`);
  console.log(`  Produk       : ${order.productCode}`);
  console.log(`  Metode bayar : ${order.method}`);
  console.log(`  Tx hash      : ${order.txHash}`);

  // Cek apakah kontrak sedang di-pause (jaga-jaga; seharusnya event
  // OrderCreated tidak akan muncul kalau paused, tapi tetap divalidasi)
  const paused = await blockchain.isPaused();
  if (paused) {
    console.warn(`[ppob-listener] Kontrak sedang paused, order ${order.orderId} dilewati untuk sementara.`);
    return;
  }

  // Ambil nomor tujuan dari database — WAJIB sudah didaftarkan frontend
  // lewat POST /api/orders/register sebelum transaksi on-chain dikirim.
  const meta = db.getOrderMeta(order.orderId);
  if (!meta) {
    console.error(`[ppob-listener] TIDAK ADA data nomor tujuan untuk order ${order.orderId}!`);
    console.error(`  Kemungkinan frontend gagal memanggil /api/orders/register sebelum transaksi.`);
    console.error(`  Order ini akan menunggu auto-refund timeout (24 jam) sebagai jaring pengaman.`);
    return;
  }

  if (meta.digiflazz_status !== 'PENDING' || meta.onchain_status !== 'CREATED') {
    console.log(`[ppob-listener] Order ${order.orderId} sudah pernah diproses sebelumnya (status: ${meta.digiflazz_status}), dilewati.`);
    return;
  }

  try {
    db.incrementRetry(order.orderId);

    // Order pascabayar (sudah melalui "cek tagihan" lewat /api/pasca/inquiry)
    // WAJIB pakai payPasca() dengan ref_id YANG SAMA seperti saat inquiry —
    // BUKAN topup(), karena mekanisme Digiflazz-nya beda total. Kalau
    // tidak ada catatan inquiry, ini order Prabayar biasa (tidak berubah).
    const inquiry = db.getInquiry(order.orderId);
    const result = inquiry
      ? await digiflazz.payPasca(order.productCode, meta.customer_no, order.orderId)
      : await digiflazz.topup(order.productCode, meta.customer_no, order.orderId);

    console.log(`[ppob-listener] Respons Digiflazz untuk order ${order.orderId}: status=${result.status}, rc=${result.rc}`);

    await settle.processDigiflazzResult(order.orderId, result);
  } catch (err) {
    console.error(`[ppob-listener] Error saat eksekusi order ${order.orderId}:`, err.message);
    // Tidak langsung report gagal ke kontrak di sini — error jaringan/API
    // sementara BUKAN berarti transaksi benar-benar gagal. Biarkan retry
    // berikutnya (lihat retryPendingOrders) atau auto-refund timeout yang
    // menangani kalau memang tidak bisa diproses sama sekali.
  }
}

/**
 * Cek ulang order yang masih menggantung (dipanggil berkala) — jaga-jaga
 * kalau ada order yang gagal diproses saat handleOrder() pertama kali
 * (misal listener sempat restart, atau Digiflazz timeout).
 */
async function retryPendingOrders() {
  const pending = db.getPendingOrders();
  if (pending.length === 0) return;

  console.log(`\n[ppob-listener] Retry check: ${pending.length} order masih menggantung`);

  for (const meta of pending) {
    // Jangan retry order yang baru saja dicoba (< 2 menit lalu) — sesuai
    // anjuran Digiflazz, hindari pemanggilan ref_id yang sama terlalu rapat.
    const secondsSinceUpdate = (Date.now() - meta.updated_at) / 1000;
    if (secondsSinceUpdate < 120) continue;

    // Batasi jumlah percobaan — kalau sudah dicoba berkali-kali dan tetap
    // pending, biarkan auto-refund timeout (24 jam) yang menyelesaikan.
    if (meta.retry_count >= 5) {
      console.warn(`[ppob-listener] Order ${meta.order_id} sudah dicoba ${meta.retry_count}x, menyerahkan ke auto-refund timeout.`);
      continue;
    }

    try {
      db.incrementRetry(meta.order_id);
      const result = await digiflazz.checkStatus(meta.product_code, meta.customer_no, meta.order_id);
      await settle.processDigiflazzResult(meta.order_id, result);
    } catch (err) {
      console.error(`[ppob-listener] Error retry order ${meta.order_id}:`, err.message);
    }
  }
}

async function catchUpMissedOrders() {
  const lastBlock = getLastProcessedBlock();
  const currentBlock = await blockchain.provider.getBlockNumber();

  // Mulai dari 200 blok terakhir saja (~10 menit di BSC) kalau belum
  // pernah jalan sebelumnya — RPC publik gratis punya rate limit ketat
  // untuk eth_getLogs pada rentang blok besar.
  const fromBlock = lastBlock ? lastBlock + 1 : currentBlock - 200;

  if (fromBlock > currentBlock) return;

  console.log(`[ppob-listener] Memeriksa order yang terlewat dari blok ${fromBlock} sampai ${currentBlock}...`);

  try {
    const missedOrders = await blockchain.getPastOrders(fromBlock);
    for (const order of missedOrders) {
      await handleOrder(order);
    }
    saveLastProcessedBlock(currentBlock);
  } catch (err) {
    // Gagal cek riwayat (misal RPC rate limit) TIDAK BOLEH menghentikan
    // listener sepenuhnya — bagian paling penting (dengarkan order BARU
    // secara real-time) harus tetap jalan. Order lama yang mungkin
    // terlewat tetap aman karena auto-refund timeout 24 jam jadi jaring
    // pengaman terakhir.
    console.warn(`[ppob-listener] Gagal memeriksa order lama (${err.code || err.message}). Melanjutkan ke mode dengar real-time...`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  INDOCOIN PPOB Listener — Starting');
  console.log('═══════════════════════════════════════════');
  console.log(`  PPOBGateway  : ${process.env.PPOB_GATEWAY_ADDRESS}`);
  console.log(`  RPC          : ${process.env.RPC_URL}`);

  const paused = await blockchain.isPaused();
  console.log(`  Status pause : ${paused ? 'PAUSED (order baru diblokir)' : 'AKTIF'}`);
  console.log('═══════════════════════════════════════════\n');

  // 1. Tangkap order yang mungkin terjadi selagi listener offline
  await catchUpMissedOrders();

  // 2. Dengarkan event baru secara real-time
  blockchain.listenForOrders(async (order) => {
    await handleOrder(order);
    const currentBlock = await blockchain.provider.getBlockNumber();
    saveLastProcessedBlock(currentBlock);
  });

  // 2b. Dengarkan event BuybackExecuted — catat ke "Dana Buyback — Sudah
  // Terpakai" setiap kali kejadian, real-time, tanpa perlu scan ulang
  // riwayat blockchain di kemudian hari.
  blockchain.listenForBuyback((data) => {
    db.incrementStat('buyback_total_indc', data.indcReceived);
    console.log(`[ppob-listener] Buyback tercatat: ${data.indcReceived} INDC (tx: ${data.txHash})`);
  });

  // 3. Jalankan pengecekan retry setiap 3 menit
  setInterval(retryPendingOrders, 3 * 60 * 1000);

  console.log('[ppob-listener] Siap. Menunggu order baru...\n');
}

main().catch((err) => {
  console.error('[ppob-listener] Fatal error saat startup:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[ppob-listener] Dihentikan.');
  process.exit(0);
});
