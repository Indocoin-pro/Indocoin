/**
 * retry-order.js
 * Skrip SEKALI PAKAI — coba ulang lapor sukses on-chain untuk order
 * yang gagal karena Backend Operator kehabisan BNB waktu itu.
 *
 * Cara pakai (dari folder ppob-backend):
 *   node retry-order.js 0x66997446da20087211094bf3d15952f0f573219dac36b491b1b2e34b11901672
 */
require('dotenv').config();
const blockchain = require('./blockchain');
const db = require('./db');
const { ethers } = require('ethers');

const orderId = process.argv[2];

if (!orderId) {
  console.error('Pakai: node retry-order.js <orderId>');
  process.exit(1);
}

(async () => {
  try {
    console.log(`Mengecek status order ${orderId} di kontrak...`);
    const order = await blockchain.getOnchainOrder(orderId);
    console.log('Status saat ini:', order.status); // 'CREATED' / 'SUCCESS' / 'REFUNDED'

    if (order.status !== 'CREATED') {
      console.log('Order ini SUDAH diproses sebelumnya (bukan CREATED lagi). Tidak perlu retry.');
      process.exit(0);
    }

    console.log('Order masih CREATED — mencoba lapor sukses ulang...');
    const txHash = await blockchain.reportSuccess(orderId);
    console.log('✅ BERHASIL! Tx hash:', txHash);

    db.updateOnchainStatus(orderId, 'SUCCESS');

    if (order.method === 'PLATFORM_INDC') {
      const modalUsdtNumber = Number(ethers.formatUnits(order.modalUsdt, 18));
      db.incrementStat('redemption_used_usdt', modalUsdtNumber);
    }

    console.log('Selesai — cek dashboard, angka pool seharusnya sudah bergerak.');
  } catch (err) {
    console.error('❌ GAGAL:', err.message);
    process.exit(1);
  }
})();
