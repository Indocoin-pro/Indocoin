/**
 * ecommerce-pricing.js
 * Perhitungan fee (biaya admin) otomatis + tanda tangan quote (Price Signer)
 * untuk fitur E-Commerce (belanja Shopee/Tokopedia lewat INDOCOIN).
 *
 * Model harga (sesuai kesepakatan):
 *   - hargaModal = harga produk + ongkir (hasil fetch otomatis dari link,
 *     apa adanya, TIDAK dimarkup).
 *   - Fee (biaya admin) DEFAULT dihitung OTOMATIS pakai kurva 2 titik:
 *       Rp10.000  -> fee Rp2.000
 *       Rp5.000.000 (batas maksimal order) -> fee Rp15.000
 *     Kurva ini logaritmik (naik cepat di awal, melandai di harga besar),
 *     supaya barang mahal tidak kena fee kegedean.
 *   - Kalau Dev sudah isi feeManual untuk suatu produk (khusus katalog
 *     unggulan, lewat panel admin bergerbang wallet Dev — sama pola
 *     dev-panel.html) -> PAKAI angka itu, override kurva otomatis.
 *   - Order dengan hargaModal > Rp5.000.000 DITOLAK (tidak bisa checkout
 *     sama sekali, bukan dialihkan ke review manual).
 */

const { ethers } = require('ethers');
require('dotenv').config();

// ─────────────────────────────────────────────────────────────────
// KURVA FEE OTOMATIS — dikunci ke 2 titik hasil kesepakatan
// ─────────────────────────────────────────────────────────────────

const FEE_HARGA_MIN = 10000;       // Rp10.000 -> fee dasar
const FEE_MIN = 2000;              // Rp2.000
const FEE_HARGA_MAX = 5000000;     // Rp5.000.000 -> batas maksimal order SEKALIGUS titik atas kurva
const FEE_MAX = 15000;             // Rp15.000

const FEE_BULATAN = 500; // dibulatkan ke atas ke kelipatan Rp500 terdekat

// Kurva: fee(h) = a + b * ln(h), diselesaikan dari 2 titik di atas.
const _b = (FEE_MAX - FEE_MIN) / Math.log(FEE_HARGA_MAX / FEE_HARGA_MIN);
const _a = FEE_MIN - _b * Math.log(FEE_HARGA_MIN);

function _bulatkanKeAtas(nilai, kelipatan) {
  return Math.ceil(nilai / kelipatan) * kelipatan;
}

/**
 * Hitung fee otomatis dari kurva, untuk hargaModal berapa pun di rentang
 * (0, FEE_HARGA_MAX]. Di bawah FEE_HARGA_MIN, fee di-clamp ke FEE_MIN
 * (jangan sampai negatif/kurang dari batas dasar).
 */
function hitungFeeKurva(hargaModal) {
  if (hargaModal <= FEE_HARGA_MIN) return FEE_MIN;
  const feeMentah = _a + _b * Math.log(hargaModal);
  const feeClamped = Math.min(Math.max(feeMentah, FEE_MIN), FEE_MAX);
  return _bulatkanKeAtas(feeClamped, FEE_BULATAN);
}

/**
 * @param {number} hargaModal   Harga produk + ongkir (Rupiah), hasil fetch
 * @param {number|null} feeManual  Override dari Dev via panel admin, atau null
 * @returns {{ diizinkan: boolean, fee: number, hargaTotal: number, alasanTolak: string|null }}
 */
function hitungFeeEcommerce(hargaModal, feeManual) {
  if (hargaModal > FEE_HARGA_MAX) {
    return { diizinkan: false, fee: 0, hargaTotal: hargaModal, alasanTolak: `Harga produk melebihi batas maksimal order (Rp${FEE_HARGA_MAX.toLocaleString('id-ID')})` };
  }
  const fee = feeManual != null ? feeManual : hitungFeeKurva(hargaModal);
  return { diizinkan: true, fee, hargaTotal: hargaModal + fee, alasanTolak: null };
}

// ─────────────────────────────────────────────────────────────────
// HARGA INDC LIVE — sama seperti ppob-pricing.js, baca dari INDC Market
// ─────────────────────────────────────────────────────────────────

const readProvider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const INDC_MARKET_ADDRESS = '0xAA488c83Dbf3bDd93543559150a0180AB56BB42E';
const indcMarketContract = new ethers.Contract(
  INDC_MARKET_ADDRESS,
  ['function currentPrice() view returns (uint256)'],
  readProvider
);

async function ambilHargaIndcLive() {
  return indcMarketContract.currentPrice();
}

// ─────────────────────────────────────────────────────────────────
// KONVERSI RUPIAH -> USDT (18 desimal) — dipakai sebelum sign quote
// ─────────────────────────────────────────────────────────────────

/**
 * @param {number} rupiah
 * @param {number} kursUsdtIdr  Kurs USDT/IDR saat ini (misal 15750)
 * @returns {bigint} setara USDT, 18 desimal
 */
function rupiahKeUsdt18(rupiah, kursUsdtIdr) {
  const usdtFloat = rupiah / kursUsdtIdr;
  // Hindari presisi floating point liar — bulatkan ke 6 desimal dulu,
  // baru dikonversi ke satuan terkecil 18 desimal.
  const usdtRounded = Math.round(usdtFloat * 1e6) / 1e6;
  return ethers.parseUnits(usdtRounded.toFixed(6), 18);
}

// ─────────────────────────────────────────────────────────────────
// TANDA TANGAN QUOTE — HARUS identik skema _verifyPriceSignature
// di EcommerceGateway.sol
//
//   messageHash = keccak256(orderId, orderRef, modalUsdt, profitUsdt, expiry, contractAddress)
//   signature   = personal_sign(messageHash)
// ─────────────────────────────────────────────────────────────────

const priceSignerWallet = new ethers.Wallet(process.env.PRICE_SIGNER_PRIVATE_KEY);

const EXPIRY_DETIK = 20 * 60; // 20 menit, sesuai kesepakatan

/**
 * @param {string} orderId    bytes32 hex string
 * @param {string} orderRef   bytes32 hex string (hash dari link produk)
 * @param {bigint} modalUsdt  setara USDT, 18 desimal
 * @param {bigint} profitUsdt setara USDT, 18 desimal (fee)
 * @param {string} contractAddress alamat EcommerceGateway
 */
async function signQuote(orderId, orderRef, modalUsdt, profitUsdt, contractAddress) {
  const expiry = Math.floor(Date.now() / 1000) + EXPIRY_DETIK;

  const messageHash = ethers.solidityPackedKeccak256(
    ['bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'address'],
    [orderId, orderRef, modalUsdt, profitUsdt, expiry, contractAddress]
  );

  const signature = await priceSignerWallet.signMessage(ethers.getBytes(messageHash));
  return { signature, expiry };
}

/**
 * Bikin orderRef (bytes32) dari link produk — dipakai sebagai referensi
 * off-chain yang "disegel" ke dalam signature, supaya quote hanya sah
 * untuk link/produk itu.
 */
function buatOrderRef(linkProduk, nomorOrderInternal) {
  return ethers.keccak256(ethers.toUtf8Bytes(`${linkProduk}|${nomorOrderInternal}`));
}

function buatOrderId() {
  return ethers.hexlify(ethers.randomBytes(32));
}

module.exports = {
  FEE_HARGA_MIN,
  FEE_MIN,
  FEE_HARGA_MAX,
  FEE_MAX,
  hitungFeeKurva,
  hitungFeeEcommerce,
  ambilHargaIndcLive,
  rupiahKeUsdt18,
  signQuote,
  buatOrderRef,
  buatOrderId,
  priceSignerAddress: priceSignerWallet.address,
};
