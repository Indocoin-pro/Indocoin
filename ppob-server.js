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
const blockchain = require('./blockchain');
const { encodeProductCode } = blockchain;

const app = express();

// CORS — WAJIB, karena ppob.html (di indocoin.id) dan API ini
// (ppob-api.indocoin.id) adalah 2 subdomain berbeda. Tanpa ini, browser
// akan blokir semua fetch() dari ppob.html walau server merespons normal
// (curl tidak kena aturan ini, makanya kelihatan "jalan" saat dites lewat SSH).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://indocoin.id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Signature');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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

/**
 * GET /api/catalog
 * Mengembalikan seluruh katalog produk aktif, dikelompokkan:
 *   { "Pulsa": { "Telkomsel": [ {kodeProduk, namaProduk, hargaJual, isPascabayar}, ... ] } }
 *
 * Harga yang dikembalikan SUDAH final (harga_jual_manual kalau ada
 * isinya, atau harga_modal apa adanya kalau belum diisi Dev) — frontend
 * tinggal tampilkan langsung, tidak perlu hitung ulang.
 */
app.get('/api/catalog', (req, res) => {
  try {
    const produk = db.getAllProducts();
    const grouped = {};

    for (const p of produk) {
      const kategori = p.category || 'Lainnya';
      const brand = p.brand || 'Lainnya';
      const type = p.type || 'Umum';

      if (!grouped[kategori]) grouped[kategori] = {};
      if (!grouped[kategori][brand]) grouped[kategori][brand] = {};
      if (!grouped[kategori][brand][type]) grouped[kategori][brand][type] = [];

      const { hargaJual } = pricing.hitungHargaJual(
        p.harga_modal,
        p.harga_jual_manual,
        !!p.is_pascabayar
      );

      grouped[kategori][brand][type].push({
        kodeProduk: p.kode_produk,
        namaProduk: p.nama_produk,
        deskripsi: p.deskripsi || '',
        hargaJual,
        hargaModal: p.harga_modal,
        isPascabayar: !!p.is_pascabayar,
      });
    }

    res.json(grouped);
  } catch (err) {
    console.error('[server.js] Error /api/catalog:', err);
    res.status(500).json({ error: 'Gagal mengambil katalog' });
  }
});

/**
 * GET /api/pool-stats
 * Data buat kartu "Transparansi Pool" di ppob.html — gabungan:
 *   - Dibaca LANGSUNG dari kontrak (real-time, selalu akurat)
 *   - Dibaca dari database kita sendiri (dicatat backend tiap kejadian,
 *     BUKAN hasil scan ulang riwayat blockchain)
 */
app.get('/api/pool-stats', async (req, res) => {
  try {
    const [redemption, pool] = await Promise.all([
      blockchain.getRedemptionVaultStatus(),
      blockchain.getPoolStatus(),
    ]);

    res.json({
      danaLikuid: {
        tersedia: redemption.available,
        sudahTerpakai: db.getStat('redemption_used_usdt'),
      },
      danaBuyback: {
        menunggu: pool.buybackPending,
        sudahTerpakai: db.getStat('buyback_total_indc'),
      },
    });
  } catch (err) {
    console.error('[server.js] Error /api/pool-stats:', err);
    res.status(500).json({ error: 'Gagal mengambil statistik pool' });
  }
});

/**
 * ===== ADMIN PANEL — hanya wallet Dev =====
 * Sesi disimpan di memori server (bukan database) — cukup untuk fitur
 * ini karena umurnya pendek (1 jam) dan tidak masalah kalau hilang
 * saat server restart (Dev tinggal tanda tangan ulang).
 */
const DEV_WALLET = '0xa16E9579E19eB19e6E24B211121BdCD7996809Cc';
const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 jam
const adminSessions = new Map(); // token -> { expiresAt }

function buatTokenAcak() {
  return require('crypto').randomBytes(24).toString('hex');
}

function cekSesiValid(token) {
  const sesi = adminSessions.get(token);
  if (!sesi) return false;
  if (Date.now() > sesi.expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

/**
 * POST /api/admin/login
 * Body: { wallet, message, signature }
 * Frontend minta wallet tanda tangani sebuah pesan (berisi timestamp),
 * di sini kita verifikasi tanda tangan itu VALID milik DEV_WALLET —
 * bukan cuma cek alamat yang connect (itu bisa dipalsukan di frontend).
 */
app.post('/api/admin/login', (req, res) => {
  try {
    const { wallet, message, signature } = req.body;
    if (!wallet || !message || !signature) {
      return res.status(400).json({ error: 'wallet, message, dan signature wajib diisi' });
    }

    // Cegah replay attack — pesan harus menyebutkan timestamp yang masih baru (< 5 menit)
    const match = message.match(/timestamp:(\d+)/);
    if (!match || Date.now() - parseInt(match[1]) > 5 * 60 * 1000) {
      return res.status(400).json({ error: 'Pesan sudah kedaluwarsa, coba lagi' });
    }

    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== DEV_WALLET.toLowerCase()) {
      return res.status(403).json({ error: 'Bukan wallet Dev' });
    }
    if (recoveredAddress.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(403).json({ error: 'Tanda tangan tidak cocok dengan wallet yang dikirim' });
    }

    const token = buatTokenAcak();
    adminSessions.set(token, { expiresAt: Date.now() + SESSION_DURATION_MS });
    res.json({ token, expiresAt: Date.now() + SESSION_DURATION_MS });
  } catch (err) {
    console.error('[server.js] Error /api/admin/login:', err);
    res.status(500).json({ error: 'Gagal verifikasi tanda tangan' });
  }
});

/**
 * POST /api/admin/set-price
 * Body: { token, kodeProduk, hargaJualManual }
 * hargaJualManual boleh null untuk mengosongkan lagi (balik ke harga asli).
 */
app.post('/api/admin/set-price', (req, res) => {
  try {
    const { token, kodeProduk, hargaJualManual } = req.body;
    if (!cekSesiValid(token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    if (!kodeProduk) {
      return res.status(400).json({ error: 'kodeProduk wajib diisi' });
    }

    const harga = hargaJualManual === null || hargaJualManual === '' ? null : Number(hargaJualManual);
    if (harga !== null && (isNaN(harga) || harga < 0)) {
      return res.status(400).json({ error: 'Harga tidak valid' });
    }

    db.setHargaJualManual(kodeProduk, harga);

    const product = db.getProduct(kodeProduk);
    const { hargaJual } = pricing.hitungHargaJual(product.harga_modal, product.harga_jual_manual, !!product.is_pascabayar);

    res.json({ success: true, kodeProduk, hargaJualBaru: hargaJual });
  } catch (err) {
    console.error('[server.js] Error /api/admin/set-price:', err);
    res.status(500).json({ error: 'Gagal ubah harga' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', priceSigner: pricing.priceSignerAddress }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server.js] API berjalan di port ${PORT}`);
  console.log(`[server.js] Price Signer address: ${pricing.priceSignerAddress}`);
});
