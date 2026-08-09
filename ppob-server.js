/**
 * server.js
 * API kecil untuk frontend (ppob.html):
 *   POST /api/quote           → hitung & tanda tangani harga sebelum user bayar
 *   POST /api/orders/register → simpan nomor tujuan (customerNo) per orderId
 *
 * Dijalankan terpisah dari ppob-listener.js (proses berbeda), tapi
 * berbagi database yang sama (db.js).
 */

const express = require('express');
const { ethers } = require('ethers');
require('dotenv').config();

const db = require('./db');
const pricing = require('./pricing');
const digiflazz = require('./digiflazz');
const settle = require('./settle');
const { encodeProductCode } = require('./blockchain');

const app = express();

// Webhook butuh raw body (untuk verifikasi signature) — daftarkan
// SEBELUM express.json() global supaya body tidak keburu di-parse.
app.post('/webhook/digiflazz', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-hub-signature'];
  const rawBody = req.body.toString('utf8');

  if (!digiflazz.verifyWebhookSignature(rawBody, signature)) {
    console.warn('[server.js] Webhook ditolak — signature tidak valid');
    return res.status(401).json({ error: 'Signature tidak valid' });
  }

  const payload = JSON.parse(rawBody);
  const data = payload.data;
  const orderId = data.ref_id; // ref_id yang kita kirim = orderId on-chain

  console.log(`[server.js] Webhook diterima untuk order ${orderId}: status=${data.status}`);

  // Proses async, tidak menahan response ke Digiflazz
  settle.processDigiflazzResult(orderId, data).catch((err) => {
    console.error(`[server.js] Error memproses webhook order ${orderId}:`, err);
  });

  res.status(200).json({ received: true });
});

app.use(express.json());

const QUOTE_VALIDITY_SECONDS = 3 * 60; // 3 menit, sesuai kesepakatan

/**
 * POST /api/quote
 * Body: { orderId, kodeProduk, usdtIdrRate }
 *
 * usdtIdrRate: kurs USDT/IDR live (didapat frontend dari Indodax/Binance
 * API, dikirim di sini) — dipakai konversi harga Rupiah ke USDT.
 */
app.post('/api/quote', async (req, res) => {
  try {
    const { orderId, kodeProduk, usdtIdrRate } = req.body;

    if (!orderId || !kodeProduk || !usdtIdrRate) {
      return res.status(400).json({ error: 'orderId, kodeProduk, dan usdtIdrRate wajib diisi' });
    }

    const product = db.getProduct(kodeProduk);
    if (!product) {
      return res.status(404).json({ error: `Produk ${kodeProduk} tidak ditemukan di katalog` });
    }
    if (product.seller_status !== 'valid') {
      return res.status(409).json({ error: `Produk ${kodeProduk} sedang tidak tersedia (seller invalid)` });
    }

    const { hargaJual, fee } = pricing.hitungHargaJual(
      product.harga_modal,
      product.harga_jual_manual,
      !!product.is_pascabayar
    );

    // Konversi Rupiah → USDT (18 desimal)
    const modalUsdt = ethers.parseUnits((product.harga_modal / usdtIdrRate).toFixed(18), 18);
    const profitUsdt = ethers.parseUnits((fee / usdtIdrRate).toFixed(18), 18);

    const expiry = Math.floor(Date.now() / 1000) + QUOTE_VALIDITY_SECONDS;
    const productCodeBytes32 = encodeProductCode(kodeProduk);

    const signature = await pricing.signQuote(
      orderId,
      productCodeBytes32,
      modalUsdt,
      profitUsdt,
      expiry,
      process.env.PPOB_GATEWAY_ADDRESS
    );

    res.json({
      orderId,
      productCode: productCodeBytes32,
      hargaModal: product.harga_modal,
      hargaJual,
      fee,
      modalUsdt: modalUsdt.toString(),
      profitUsdt: profitUsdt.toString(),
      expiry,
      signature,
    });
  } catch (err) {
    console.error('[server.js] Error /api/quote:', err);
    res.status(500).json({ error: 'Gagal membuat quote' });
  }
});

/**
 * POST /api/orders/register
 * Body: { orderId, customerNo, kodeProduk }
 *
 * WAJIB dipanggil frontend SEBELUM (atau bersamaan dengan) user
 * mengirim transaksi on-chain — supaya listener tahu nomor tujuan
 * saat event OrderCreated muncul.
 */
app.post('/api/orders/register', (req, res) => {
  try {
    const { orderId, customerNo, kodeProduk } = req.body;
    if (!orderId || !customerNo || !kodeProduk) {
      return res.status(400).json({ error: 'orderId, customerNo, dan kodeProduk wajib diisi' });
    }
    db.registerOrder(orderId, customerNo, kodeProduk);
    res.json({ success: true });
  } catch (err) {
    console.error('[server.js] Error /api/orders/register:', err);
    res.status(500).json({ error: 'Gagal mendaftarkan order' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', priceSigner: pricing.priceSignerAddress }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server.js] API berjalan di port ${PORT}`);
  console.log(`[server.js] Price Signer address: ${pricing.priceSignerAddress}`);
});
