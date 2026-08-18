/**
 * settle.js
 * Logika bersama: terjemahkan hasil respons Digiflazz (Sukses/Gagal/
 * Pending) jadi aksi ke smart contract. Dipakai oleh ppob-listener.js
 * (saat hasil langsung didapat) DAN oleh webhook receiver di server.js
 * (saat status "Pending" akhirnya di-update Digiflazz belakangan).
 */

const db = require('./db');
const blockchain = require('./blockchain');

/**
 * @param {string} orderId
 * @param {object} digiflazzResult  Hasil dari digiflazz.topup()/checkStatus()
 *                                    — punya field .status ("Sukses"/"Gagal"/"Pending")
 */
async function processDigiflazzResult(orderId, digiflazzResult) {
  const status = digiflazzResult.status;

  db.updateDigiflazzStatus(orderId, status, digiflazzResult.ref_id, digiflazzResult.sn);

  if (status === 'Sukses') {
    console.log(`[settle.js] Order ${orderId} SUKSES di Digiflazz (SN: ${digiflazzResult.sn || '-'}). Melapor ke kontrak...`);
    try {
      const txHash = await blockchain.reportSuccess(orderId);
      db.updateOnchainStatus(orderId, 'SUCCESS');
      console.log(`[settle.js] Order ${orderId} berhasil dilaporkan sukses on-chain. Tx: ${txHash}`);

      // Catat ke "Dana Likuid — Sudah Terpakai" KHUSUS untuk order yang
      // dibayar dari Platform Wallet (INDC) — cuma order jenis ini yang
      // benar-benar menarik dari Redemption Vault.
      const order = await blockchain.getOnchainOrder(orderId);
      if (order.method === 'PLATFORM_INDC') {
        const modalUsdtNumber = Number(require('ethers').formatUnits(order.modalUsdt, 18));
        db.incrementStat('redemption_used_usdt', modalUsdtNumber);
      }
    } catch (err) {
      // Kemungkinan sebab: order sudah diproses sebelumnya (misal race
      // dengan auto-refund timeout), atau backend kehabisan gas BNB.
      console.error(`[settle.js] GAGAL lapor sukses on-chain untuk order ${orderId}:`, err.message);
    }
    return 'SUCCESS';
  }

  if (status === 'Gagal') {
    console.log(`[settle.js] Order ${orderId} GAGAL di Digiflazz (${digiflazzResult.message || '-'}). Memicu refund...`);
    try {
      const txHash = await blockchain.reportFailed(orderId);
      db.updateOnchainStatus(orderId, 'REFUNDED');
      console.log(`[settle.js] Order ${orderId} berhasil dilaporkan gagal on-chain, refund diproses. Tx: ${txHash}`);
    } catch (err) {
      console.error(`[settle.js] GAGAL lapor kegagalan on-chain untuk order ${orderId}:`, err.message);
    }
    return 'REFUNDED';
  }

  // status === 'Pending' — tidak melakukan apa-apa ke kontrak dulu.
  // Order tetap CREATED, akan di-resolve oleh webhook Digiflazz nanti,
  // atau oleh auto-refund timeout 24 jam sebagai jaring pengaman
  // terakhir kalau webhook tidak pernah datang.
  console.log(`[settle.js] Order ${orderId} masih PENDING di Digiflazz, menunggu update lanjutan.`);
  return 'PENDING';
}

module.exports = { processDigiflazzResult };
