/**
 * pricing.js
 * Perhitungan harga jual + fungsi tanda tangan harga (Price Signer).
 *
 * Model harga (disederhanakan sesuai keputusan terakhir):
 *   - Default: harga_jual = harga_modal (apa adanya dari Digiflazz, TANPA
 *     markup otomatis). Modal masuk lebih dulu, Dev isi margin manual
 *     pelan-pelan lewat admin panel kapan pun siap — produk tetap tampil
 *     & bisa dibeli selama masa itu, bukan disembunyikan.
 *   - Kalau harga_jual_manual sudah diisi Dev → PAKAI angka itu, apa pun
 *     nilainya (bisa di atas atau di bawah harga_modal, terserah Dev).
 *   - Pascabayar: harga_jual = harga_modal + biaya_admin_tambahan (kalau
 *     diisi Dev). TIDAK PERNAH menerima harga_jual_manual (override total
 *     harga) — komisi/tagihan tetap apa adanya dari Digiflazz, Dev cuma
 *     bisa nambah biaya admin di atasnya, bukan ganti angka totalnya.
 */

const { ethers } = require('ethers');
require('dotenv').config();

/**
 * @param {number} hargaModal        Harga modal dari katalog (Rupiah)
 * @param {number|null} hargaJualManual  Harga override dari Dev, atau null
 * @param {boolean} isPascabayar     True kalau kategori Pascabayar
 * @param {number|null} biayaAdminTambahan  Khusus pascabayar — biaya admin
 *   tambahan yang Dev tentukan (di atas biaya admin asli dari Digiflazz)
 * @returns {{ hargaJual: number, fee: number }}
 */
function hitungHargaJual(hargaModal, hargaJualManual, isPascabayar, biayaAdminTambahan) {
  if (isPascabayar) {
    const tambahan = biayaAdminTambahan || 0;
    return { hargaJual: hargaModal + tambahan, fee: tambahan };
  }
  if (hargaJualManual != null) {
    return { hargaJual: hargaJualManual, fee: hargaJualManual - hargaModal };
  }
  return { hargaJual: hargaModal, fee: 0 };
}

const priceSignerWallet = new ethers.Wallet(process.env.PRICE_SIGNER_PRIVATE_KEY);

/**
 * Tanda tangani quote harga — HARUS identik dengan skema verifikasi
 * di kontrak (_verifyPriceSignature):
 *
 *   messageHash = keccak256(orderId, productCode, modalUsdt, profitUsdt, expiry, contractAddress)
 *   signature   = personal_sign(messageHash)
 *
 * @param {string} orderId       bytes32 hex string
 * @param {string} productCode  bytes32 hex string (hasil encodeProductCode)
 * @param {bigint} modalUsdt    dalam satuan terkecil USDT (18 desimal)
 * @param {bigint} profitUsdt   dalam satuan terkecil USDT (18 desimal)
 * @param {number} expiry        unix timestamp (detik)
 * @param {string} contractAddress alamat PPOBGateway
 */
async function signQuote(orderId, productCode, modalUsdt, profitUsdt, expiry, contractAddress) {
  const messageHash = ethers.solidityPackedKeccak256(
    ['bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'address'],
    [orderId, productCode, modalUsdt, profitUsdt, expiry, contractAddress]
  );

  // ethers otomatis membungkus dengan prefix "\x19Ethereum Signed Message:\n32"
  // saat menandatangani 32 byte — cocok dengan skema ecrecover di kontrak.
  const signature = await priceSignerWallet.signMessage(ethers.getBytes(messageHash));
  return signature;
}

module.exports = {
  hitungHargaJual,
  signQuote,
  priceSignerAddress: priceSignerWallet.address,
};
