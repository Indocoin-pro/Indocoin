/**
 * digiflazz.js
 * Klien API Digiflazz — eksekusi transaksi (topup), cek status,
 * transaksi pascabayar (cek tagihan + bayar), dan verifikasi
 * signature webhook.
 *
 * Referensi resmi: developer.digiflazz.com/api/buyer/topup/
 *                  developer.digiflazz.com/api/buyer/cek-tagihan/
 *                  developer.digiflazz.com/api/buyer/bayar-tagihan/
 */

const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const USERNAME = process.env.DIGIFLAZZ_USERNAME;
const API_KEY = process.env.DIGIFLAZZ_APIKEY;
const WEBHOOK_SECRET = process.env.DIGIFLAZZ_WEBHOOK_SECRET;
const TESTING_MODE = process.env.DIGIFLAZZ_TESTING_MODE === 'true';

const TRANSACTION_URL = 'https://api.digiflazz.com/v1/transaction';

if (!USERNAME || !API_KEY) {
  console.error('[digiflazz.js] DIGIFLAZZ_USERNAME / DIGIFLAZZ_APIKEY belum diisi di .env');
}

function signTopup(refId) {
  return crypto.createHash('md5').update(USERNAME + API_KEY + refId).digest('hex');
}

/**
 * Eksekusi topup/pembelian produk prabayar.
 * Sesuai dokumentasi resmi: transaksi diproses SINKRON — response
 * langsung berisi status Sukses/Gagal/Pending.
 *
 * @param {string} buyerSkuCode Kode produk Digiflazz (misal "xld25")
 * @param {string} customerNo   Nomor tujuan (HP/meteran/dst)
 * @param {string} refId        ID unik — WAJIB sama dengan orderId on-chain
 *                               (dipakai juga untuk cek status ulang)
 */
async function topup(buyerSkuCode, customerNo, refId) {
  const payload = {
    username: USERNAME,
    buyer_sku_code: buyerSkuCode,
    customer_no: customerNo,
    ref_id: refId,
    sign: signTopup(refId),
  };

  if (TESTING_MODE) {
    payload.testing = true;
  }

  const res = await axios.post(TRANSACTION_URL, payload, { timeout: 30000 });
  return res.data.data; // Digiflazz membungkus response dalam field "data"
}

/**
 * Cek status transaksi yang sudah ada — caranya PERSIS sama seperti
 * topup() dengan ref_id yang SAMA (bukan endpoint terpisah).
 *
 * PENTING sesuai dokumentasi resmi:
 * - Jangan panggil ulang untuk ref_id yang sama dalam interval < 1 menit
 *   (risiko race condition)
 * - Jangan cek status transaksi yang sudah lewat 90 hari (akan dianggap
 *   transaksi BARU, bukan cek status)
 */
async function checkStatus(buyerSkuCode, customerNo, refId) {
  return topup(buyerSkuCode, customerNo, refId);
}

/**
 * CEK TAGIHAN pascabayar (inq-pasca) — langkah WAJIB sebelum bayar,
 * karena jumlah tagihan asli tidak pernah diketahui dari katalog statis
 * (beda-beda tiap nomor pelanggan). Skema tanda tangan SAMA seperti
 * topup() (md5 username+apikey+ref_id).
 *
 * @param {string} buyerSkuCode Kode produk pascabayar (misal "pln")
 * @param {string} customerNo   Nomor pelanggan
 * @param {string} refId        ID unik — akan dipakai LAGI persis sama
 *                               saat bayarPasca() dipanggil nanti
 * @returns {object} { customer_name, price, admin, status, message, rc, ... }
 *                    price = total yang harus dibayar (tagihan + admin
 *                    asli dari Digiflazz), admin = komponen biaya admin
 */
async function inqPasca(buyerSkuCode, customerNo, refId) {
  const payload = {
    commands: 'inq-pasca',
    username: USERNAME,
    buyer_sku_code: buyerSkuCode,
    customer_no: customerNo,
    ref_id: refId,
    sign: signTopup(refId),
  };
  if (TESTING_MODE) payload.testing = true;

  const res = await axios.post(TRANSACTION_URL, payload, { timeout: 30000 });
  return res.data.data;
}

/**
 * BAYAR TAGIHAN pascabayar (pay-pasca) — WAJIB dipanggil dengan ref_id
 * YANG SAMA PERSIS seperti saat inqPasca() sebelumnya, dan WAJIB di
 * HARI YANG SAMA (aturan resmi Digiflazz, transaksi ditolak kalau beda
 * tanggal dari saat cek tagihan).
 *
 * @param {string} buyerSkuCode Kode produk pascabayar
 * @param {string} customerNo   Nomor pelanggan (harus sama dengan inqPasca)
 * @param {string} refId        WAJIB sama persis dengan ref_id inqPasca
 */
async function payPasca(buyerSkuCode, customerNo, refId) {
  const payload = {
    commands: 'pay-pasca',
    username: USERNAME,
    buyer_sku_code: buyerSkuCode,
    customer_no: customerNo,
    ref_id: refId,
    sign: signTopup(refId),
  };
  if (TESTING_MODE) payload.testing = true;

  const res = await axios.post(TRANSACTION_URL, payload, { timeout: 30000 });
  return res.data.data;
}

/**
 * Verifikasi signature webhook dari Digiflazz (header X-Hub-Signature,
 * format "sha1=<hex>"). Mencegah notifikasi palsu yang mengaku-aku
 * dari Digiflazz.
 *
 * @param {string} rawBody   Body request MENTAH (belum di-parse JSON)
 * @param {string} signatureHeader  Isi header X-Hub-Signature
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith('sha1=')) return false;
  if (!WEBHOOK_SECRET) {
    console.warn('[digiflazz.js] DIGIFLAZZ_WEBHOOK_SECRET belum diisi — verifikasi dilewati (TIDAK AMAN)');
    return false;
  }

  const expectedSig = crypto
    .createHmac('sha1', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const receivedSig = signatureHeader.replace('sha1=', '');

  // Bandingkan dengan waktu konstan untuk mencegah timing attack
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  const receivedBuf = Buffer.from(receivedSig, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = {
  topup,
  checkStatus,
  inqPasca,
  payPasca,
  verifyWebhookSignature,
  signTopup,
};
