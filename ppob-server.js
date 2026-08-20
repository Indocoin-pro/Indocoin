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
const axios = require('axios');
require('dotenv').config();

const db = require('./db');
const pricing = require('./pricing');
const digiflazz = require('./digiflazz');
const settle = require('./settle');
const blockchain = require('./blockchain');
const topup = require('./topup');
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
/**
 * Saklar sementara — nonaktifkan pembayaran INDC sampai Dana Likuid
 * cukup besar. Ini pengaman SEBENARNYA (beda dari yang di ppob.html
 * yang cuma sembunyiin tombol) — kontrak PPOBGateway WAJIB signature
 * dari sini untuk memproses payWithPlatformINDC, jadi memblokir di
 * titik ini tidak bisa dilewati siapa pun, termasuk lewat panggilan
 * API langsung tanpa lewat website.
 */
const INDC_PAYMENT_ENABLED = false;

app.post('/api/quote', async (req, res) => {
  try {
    const { orderId, kodeProduk, usdtIdrRate, metode, wallet } = req.body;

    if (!orderId || !kodeProduk || !usdtIdrRate) {
      return res.status(400).json({ error: 'orderId, kodeProduk, dan usdtIdrRate wajib diisi' });
    }

    if (metode === 'indc') {
      if (!INDC_PAYMENT_ENABLED) {
        return res.status(403).json({ error: 'Pembayaran pakai INDC sementara ditutup sampai Dana Likuid terkumpul lebih banyak dari aktivitas transaksi. Sementara ini bisa pakai USDT dulu ya!' });
      }
      if (!wallet) {
        return res.status(400).json({ error: 'wallet wajib diisi untuk pembayaran INDC' });
      }
      if (db.sudahPakaiIndcHariIni(wallet)) {
        return res.status(429).json({ error: 'Jatah pembayaran INDC untuk wallet ini sudah terpakai hari ini. Coba lagi besok, atau pakai USDT.' });
      }
    }

    const product = db.getProduct(kodeProduk);
    if (!product) {
      return res.status(404).json({ error: `Produk ${kodeProduk} tidak ditemukan di katalog` });
    }
    if (product.seller_status !== 'valid') {
      return res.status(409).json({ error: `Produk ${kodeProduk} sedang tidak tersedia (seller invalid)` });
    }

    // Pascabayar YANG SUDAH DICEK TAGIHANNYA (via /api/pasca/inquiry) —
    // pakai angka ASLI hasil cek tagihan, BUKAN harga katalog statis
    // (yang cuma penampung biaya admin, bukan tagihan sebenarnya).
    // Kalau tidak ada inquiry (kasus Prabayar), jalur & hasil hitungan
    // TETAP PERSIS SAMA seperti sebelumnya.
    const inquiry = db.getInquiry(orderId);

    let hargaModalUntukQuote, feeUntukQuote, hargaJual;
    if (inquiry) {
      // modal = biaya bersih yang BENERAN kita keluarkan ke Digiflazz
      // (tagihan+admin, DIKURANGI komisi yang jadi diskon buat kita).
      // profit = komisi (margin dari Digiflazz) + biaya admin tambahan
      // (margin sendiri) — DUA-DUANYA ikut ke Buyback/Redemption/dst,
      // sama seperti alur Prabayar.
      hargaModalUntukQuote = inquiry.harga_asli - inquiry.komisi_digiflazz;
      feeUntukQuote = inquiry.komisi_digiflazz + inquiry.biaya_admin_tambahan;
      hargaJual = inquiry.total_bayar;
    } else {
      const hasil = pricing.hitungHargaJual(
        product.harga_modal,
        product.harga_jual_manual,
        !!product.is_pascabayar,
        product.biaya_admin_tambahan
      );
      hargaModalUntukQuote = product.harga_modal;
      feeUntukQuote = hasil.fee;
      hargaJual = hasil.hargaJual;
    }

    // Konversi Rupiah → USDT (18 desimal)
    const modalUsdt = ethers.parseUnits((hargaModalUntukQuote / usdtIdrRate).toFixed(18), 18);
    const profitUsdt = ethers.parseUnits((feeUntukQuote / usdtIdrRate).toFixed(18), 18);

    const expiry = Math.floor(Date.now() / 1000) + QUOTE_VALIDITY_SECONDS;
    const productCodeBytes32 = encodeProductCode(kodeProduk);

    let signature, indcPriceUsdt = null;

    if (metode === 'indc') {
      // Pembayaran INDC — WAJIB pakai signature versi baru yang juga
      // "menyegel" harga INDC saat itu (langsung dari kontrak INDC
      // Market, bukan angka manual), sesuai perbaikan celah keamanan
      // di kontrak PPOBGateway yang baru.
      indcPriceUsdt = await pricing.ambilHargaIndcLive();
      signature = await pricing.signQuoteWithIndcPrice(
        orderId,
        productCodeBytes32,
        modalUsdt,
        profitUsdt,
        indcPriceUsdt,
        expiry,
        process.env.PPOB_GATEWAY_ADDRESS
      );
    } else {
      // Pembayaran USDT — TIDAK BERUBAH sama sekali dari sebelumnya
      signature = await pricing.signQuote(
        orderId,
        productCodeBytes32,
        modalUsdt,
        profitUsdt,
        expiry,
        process.env.PPOB_GATEWAY_ADDRESS
      );
    }

    if (metode === 'indc') {
      db.catatPakaiIndcHariIni(wallet, orderId);
    }

    res.json({
      orderId,
      productCode: productCodeBytes32,
      hargaModal: hargaModalUntukQuote,
      hargaJual,
      fee: feeUntukQuote,
      modalUsdt: modalUsdt.toString(),
      profitUsdt: profitUsdt.toString(),
      indcPriceUsdt: indcPriceUsdt != null ? indcPriceUsdt.toString() : null,
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
    const { orderId, customerNo, kodeProduk, walletUser } = req.body;
    if (!orderId || !customerNo || !kodeProduk) {
      return res.status(400).json({ error: 'orderId, customerNo, dan kodeProduk wajib diisi' });
    }
    db.registerOrder(orderId, customerNo, kodeProduk, walletUser);
    res.json({ success: true });
  } catch (err) {
    console.error('[server.js] Error /api/orders/register:', err);
    res.status(500).json({ error: 'Gagal mendaftarkan order' });
  }
});

/** Riwayat pesanan milik 1 wallet — dipakai fitur Riwayat di frontend. */
app.get('/api/orders/history/:wallet', (req, res) => {
  try {
    const wallet = req.params.wallet;
    if (!wallet) {
      return res.status(400).json({ error: 'Alamat wallet wajib diisi' });
    }
    const rows = db.getOrderHistoryByWallet(wallet.toLowerCase());

    const hasil = rows.map(r => {
      // Status yang gampang dipahami user, gabungan dari 2 status internal.
      // 'GAGAL_KIRIM' SENGAJA dipisah dari 'PENDING' biasa — order jenis
      // ini gagal SEBELUM sempat diterima Digiflazz (bisa direfund manual
      // dengan aman), beda dari PENDING asli yang berarti Digiflazz SUDAH
      // menerima dan masih memprosesnya (JANGAN boleh direfund manual,
      // supaya tidak dobel: produk terkirim TAPI user juga sudah direfund).
      let statusTampil, bisaRefundManual = false;
      if (r.onchain_status === 'SUCCESS') statusTampil = 'Berhasil';
      else if (r.onchain_status === 'REFUNDED') statusTampil = 'Direfund';
      else if (r.digiflazz_status === 'GAGAL_KIRIM') {
        statusTampil = 'Gagal Terkirim';
        bisaRefundManual = true;
      } else statusTampil = 'Diproses';

      return {
        orderId: r.order_id,
        namaProduk: r.nama_produk || r.product_code,
        nomorTujuan: r.customer_no,
        harga: r.harga_pascabayar != null ? r.harga_pascabayar : r.harga_prabayar,
        status: statusTampil,
        bisaRefundManual,
        sn: r.sn || null,
        lastError: r.last_error || null,
        createdAt: r.created_at,
      };
    });

    res.json({ orders: hasil });
  } catch (err) {
    console.error('[server.js] Error /api/orders/history:', err);
    res.status(500).json({ error: 'Gagal mengambil riwayat pesanan' });
  }
});

/**
 * POST /api/orders/refund-manual
 * Body: { orderId, wallet }
 *
 * Tombol "Ajukan Refund" di halaman riwayat. SENGAJA cuma diizinkan
 * untuk order berstatus 'GAGAL_KIRIM' (gagal SEBELUM sempat diterima
 * Digiflazz) DAN masih 'CREATED' di on-chain (belum pernah dilaporkan
 * sukses/gagal sebelumnya) — supaya tidak mungkin dipakai buat order
 * yang sebenarnya masih diproses normal oleh Digiflazz (mencegah
 * kerugian ganda: produk terkirim TAPI user juga sudah direfund).
 */
app.post('/api/orders/refund-manual', async (req, res) => {
  try {
    const { orderId, wallet } = req.body;
    if (!orderId || !wallet) {
      return res.status(400).json({ error: 'orderId dan wallet wajib diisi' });
    }

    const meta = db.getOrderMeta(orderId);
    if (!meta) {
      return res.status(404).json({ error: 'Order tidak ditemukan' });
    }
    if (!meta.wallet_user || meta.wallet_user.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(403).json({ error: 'Order ini bukan milik wallet yang terhubung' });
    }
    if (meta.digiflazz_status !== 'GAGAL_KIRIM') {
      return res.status(400).json({ error: 'Order ini masih diproses normal oleh Digiflazz, belum bisa direfund manual' });
    }
    if (meta.onchain_status !== 'CREATED') {
      return res.status(400).json({ error: 'Order ini sudah diselesaikan sebelumnya' });
    }

    const txHash = await blockchain.reportFailed(orderId);
    db.updateOnchainStatus(orderId, 'REFUNDED');
    console.log(`[server.js] Refund manual berhasil untuk order ${orderId} (diminta wallet ${wallet}). Tx: ${txHash}`);

    res.json({ success: true, txHash });
  } catch (err) {
    console.error('[server.js] Error /api/orders/refund-manual:', err);
    res.status(500).json({ error: 'Gagal memproses refund. Coba lagi beberapa saat.' });
  }
});

/**
 * POST /api/pasca/inquiry
 * "Cek Tagihan" pascabayar — WAJIB dipanggil sebelum bayar, karena
 * jumlah tagihan asli tidak pernah diketahui dari katalog statis
 * (beda-beda tiap nomor pelanggan). orderId di sini akan dipakai LAGI
 * persis sama sebagai ref_id Digiflazz saat pembayaran nanti (dan juga
 * sebagai orderId on-chain) — satu ID dipakai konsisten di 3 tempat.
 */
app.post('/api/pasca/inquiry', async (req, res) => {
  try {
    const { orderId, kodeProduk, customerNo } = req.body;
    if (!orderId || !kodeProduk || !customerNo) {
      return res.status(400).json({ error: 'orderId, kodeProduk, dan customerNo wajib diisi' });
    }

    const product = db.getProduct(kodeProduk);
    if (!product) {
      return res.status(404).json({ error: `Produk ${kodeProduk} tidak ditemukan di katalog` });
    }
    if (!product.is_pascabayar) {
      return res.status(400).json({ error: 'Produk ini bukan produk pascabayar' });
    }

    const refIdDigiflazz = digiflazz.toDigiflazzRefId(orderId);
    const hasil = await digiflazz.inqPasca(kodeProduk, customerNo, refIdDigiflazz);

    if (hasil.status !== 'Sukses') {
      return res.status(422).json({ error: hasil.message || 'Gagal cek tagihan', rc: hasil.rc });
    }

    const hargaAsli = hasil.price; // total dari Digiflazz (tagihan + admin asli mereka)
    const adminDigiflazz = hasil.admin || 0;
    const komisiDigiflazz = product.komisi || 0; // margin kita, dari katalog (field "commission" Digiflazz)
    const biayaAdminTambahan = product.biaya_admin_tambahan || 0;
    const totalBayar = hargaAsli + biayaAdminTambahan;

    db.saveInquiry({
      orderId, kodeProduk, customerNo,
      customerName: hasil.customer_name,
      hargaAsli, adminDigiflazz, komisiDigiflazz, biayaAdminTambahan, totalBayar,
    });

    res.json({
      customerName: hasil.customer_name,
      hargaAsli,
      adminDigiflazz,
      biayaAdminTambahan,
      totalBayar,
    });
  } catch (err) {
    // Axios error object aslinya dalam, sering kepotong di log PM2 —
    // ambil pesan asli dari Digiflazz (kalau ada) supaya kebaca jelas.
    const pesanDigiflazz = err.response?.data?.data?.message || err.message;
    console.error('[server.js] Error /api/pasca/inquiry:', pesanDigiflazz, JSON.stringify(err.response?.data || {}));
    res.status(500).json({ error: 'Gagal cek tagihan, coba lagi' });
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
        !!p.is_pascabayar,
        p.biaya_admin_tambahan
      );

      grouped[kategori][brand][type].push({
        kodeProduk: p.kode_produk,
        namaProduk: p.nama_produk,
        deskripsi: p.deskripsi || '',
        hargaJual,
        hargaModal: p.harga_modal,
        hargaReferensi: p.harga_referensi || null,
        biayaAdminTambahan: p.biaya_admin_tambahan || null,
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
    const { hargaJual } = pricing.hitungHargaJual(product.harga_modal, product.harga_jual_manual, !!product.is_pascabayar, product.biaya_admin_tambahan);

    res.json({ success: true, kodeProduk, hargaJualBaru: hargaJual });
  } catch (err) {
    console.error('[server.js] Error /api/admin/set-price:', err);
    res.status(500).json({ error: 'Gagal ubah harga' });
  }
});

/**
 * POST /api/admin/set-biaya-admin
 * KHUSUS produk pascabayar — biaya admin tambahan yang Dev tentukan
 * sendiri, ditambahkan di atas biaya admin asli dari Digiflazz (kalau
 * ada). Kirim null untuk mengosongkan lagi.
 */
app.post('/api/admin/set-biaya-admin', (req, res) => {
  try {
    const { token, kodeProduk, biayaAdminTambahan } = req.body;
    if (!cekSesiValid(token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    if (!kodeProduk) {
      return res.status(400).json({ error: 'kodeProduk wajib diisi' });
    }

    const biaya = biayaAdminTambahan === null || biayaAdminTambahan === '' ? null : Number(biayaAdminTambahan);
    if (biaya !== null && (isNaN(biaya) || biaya < 0)) {
      return res.status(400).json({ error: 'Biaya admin tidak valid' });
    }

    db.setBiayaAdminTambahan(kodeProduk, biaya);

    const product = db.getProduct(kodeProduk);
    const { hargaJual } = pricing.hitungHargaJual(product.harga_modal, product.harga_jual_manual, !!product.is_pascabayar, product.biaya_admin_tambahan);

    res.json({ success: true, kodeProduk, hargaJualBaru: hargaJual });
  } catch (err) {
    console.error('[server.js] Error /api/admin/set-biaya-admin:', err);
    res.status(500).json({ error: 'Gagal ubah biaya admin' });
  }
});

/**
 * POST /api/admin/set-harga-referensi
 * Harga "dicoret" — murni tampilan, tidak memengaruhi hitungan apapun.
 * Body: { token, kodeProduk, hargaReferensi } — kirim null untuk hapus.
 */
app.post('/api/admin/set-harga-referensi', (req, res) => {
  try {
    const { token, kodeProduk, hargaReferensi } = req.body;
    if (!cekSesiValid(token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    if (!kodeProduk) {
      return res.status(400).json({ error: 'kodeProduk wajib diisi' });
    }

    const harga = hargaReferensi === null || hargaReferensi === '' ? null : Number(hargaReferensi);
    if (harga !== null && (isNaN(harga) || harga < 0)) {
      return res.status(400).json({ error: 'Harga tidak valid' });
    }

    db.setHargaReferensi(kodeProduk, harga);
    res.json({ success: true, kodeProduk, hargaReferensiBaru: harga });
  } catch (err) {
    console.error('[server.js] Error /api/admin/set-harga-referensi:', err);
    res.status(500).json({ error: 'Gagal ubah harga referensi' });
  }
});

// ═══════════════════════════════════════════════════════════
// TOP UP USDT PAKAI RUPIAH/QRIS
// ═══════════════════════════════════════════════════════════

/** Ambil kurs USDT/IDR — dihitung SERVER-SIDE (bukan percaya angka dari
 * client), karena endpoint ini menentukan berapa USDT sungguhan yang
 * dikirim ke wallet user. Sumbernya sama seperti yang dipakai frontend
 * (rasio harga BNB dalam IDR vs USD), supaya konsisten. */
async function ambilKursUsdtIdrServer() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd,idr');
    return res.data.binancecoin.idr / res.data.binancecoin.usd;
  } catch (err) {
    console.warn('[server.js] Gagal ambil kurs top up, pakai fallback 16500:', err.message);
    return 16500;
  }
}

/**
 * POST /api/topup/request
 * Body: { wallet, nominalRupiah }
 * Customer minta bikin permintaan top up baru.
 */
/**
 * GET /api/topup/active/:wallet
 * Cek apakah wallet ini masih punya permintaan PENDING yang aktif
 * (belum lewat 30 menit). Dipakai frontend saat modal dibuka, supaya
 * kalau user tutup-buka modal lagi, dia tetap diarahkan ke step QRIS +
 * tombol Batalkan yang benar — bukan form kosong yang bikin permintaan
 * lama jadi "tersembunyi" dan tidak bisa dibatalkan.
 */
app.get('/api/topup/active/:wallet', (req, res) => {
  try {
    const active = db.getTopupPendingAktif(req.params.wallet);
    res.json({ active: active || null });
  } catch (err) {
    console.error('[server.js] Error /api/topup/active:', err);
    res.status(500).json({ error: 'Gagal cek permintaan aktif' });
  }
});

/**
 * Saklar sementara — sama seperti INDC_PAYMENT_ENABLED di ppob.html,
 * ini pengaman SEBENARNYA (frontend cuma sembunyiin, ini yang beneran
 * nolak) sambil nunggu QRIS siap. Ganti ke true kalau sudah siap buka.
 */
const TOPUP_FEATURE_ENABLED = true;

app.post('/api/topup/request', async (req, res) => {
  try {
    if (!TOPUP_FEATURE_ENABLED) {
      return res.status(403).json({ error: 'Fitur ini akan segera dibuka dalam beberapa jam ke depan.' });
    }
    const { wallet, nominalRupiah } = req.body;
    if (!wallet || !nominalRupiah) {
      return res.status(400).json({ error: 'wallet dan nominalRupiah wajib diisi' });
    }
    const nominal = Number(nominalRupiah);
    if (!Number.isInteger(nominal) || nominal <= 0) {
      return res.status(400).json({ error: 'nominalRupiah tidak valid' });
    }

    const min = db.getTopupSetting('min_rupiah') || 50000;
    const max = db.getTopupSetting('max_rupiah') || 100000;
    if (nominal < min || nominal > max) {
      return res.status(400).json({ error: `Nominal harus antara Rp${min.toLocaleString('id-ID')} - Rp${max.toLocaleString('id-ID')}` });
    }

    const requestAktif = db.getTopupPendingAktif(wallet);
    if (requestAktif) {
      return res.status(409).json({
        error: 'Kamu masih punya permintaan top up yang aktif. Selesaikan atau tunggu itu dulu.',
        requestAktif,
      });
    }

    // Cari kode unik 3 digit yang belum kepakai untuk nominal yang
    // sama, di antara request PENDING lain yang masih aktif
    let kodeUnik;
    let percobaan = 0;
    do {
      kodeUnik = String(Math.floor(Math.random() * 900) + 100); // 100-999
      percobaan++;
    } while (db.kodeUnikSudahDipakai(nominal, kodeUnik) && percobaan < 50);

    // Kode unik 3 digit langsung DITAMBAHKAN ke nominal yang diminta,
    // supaya angka yang harus ditransfer selalu unik dan gampang
    // dicocokkan ke mutasi bank. Fee & jumlah USDT tetap dihitung dari
    // nominal ASLI yang diminta user (bukan totalBayar) — selisih
    // beberapa ratus rupiah dari kode unik itu murni penanda, bukan
    // nilai top up tambahan.
    const feeRupiah = db.cariFeeUntukNominal(nominal);
    const nominalSetelahFee = nominal - feeRupiah;
    if (nominalSetelahFee <= 0) {
      return res.status(400).json({ error: 'Nominal terlalu kecil setelah dipotong biaya' });
    }

    const kurs = await ambilKursUsdtIdrServer();
    const usdtAmount = nominalSetelahFee / kurs;
    const totalBayar = nominal + Number(kodeUnik);

    const topupId = ethers.keccak256(ethers.toUtf8Bytes(`${wallet.toLowerCase()}-${nominal}-${kodeUnik}-${Date.now()}`));

    db.buatTopupRequest({ topupId, wallet, nominalRupiah: nominal, kodeUnik, feeRupiah, usdtAmount });

    res.json({
      topupId,
      nominalDiminta: nominal,
      kodeUnik,
      totalBayar,   // <- ini yang ditampilkan & harus ditransfer persis oleh user
      feeRupiah,
      usdtAmount,
      kurs,
    });
  } catch (err) {
    console.error('[server.js] Error /api/topup/request:', err);
    res.status(500).json({ error: 'Gagal membuat permintaan top up' });
  }
});

/**
 * GET /api/topup/status/:topupId
 * Customer cek status permintaan top up-nya (polling dari frontend).
 */
/**
 * GET /api/topup/history/:wallet
 * Riwayat top up milik 1 wallet, SEMUA status — dipakai riwayat.html.
 */
/**
 * POST /api/topup/cancel
 * Body: { wallet, topupId }
 * User membatalkan permintaan top up MILIK SENDIRI yang masih PENDING —
 * langsung membebaskan slot "1 request aktif per wallet", tanpa perlu
 * nunggu 30 menit kedaluwarsa.
 */
app.post('/api/topup/cancel', (req, res) => {
  try {
    const { wallet, topupId } = req.body;
    if (!wallet || !topupId) {
      return res.status(400).json({ error: 'wallet dan topupId wajib diisi' });
    }
    const berhasil = db.batalkanTopupRequest(topupId, wallet);
    if (!berhasil) {
      return res.status(400).json({ error: 'Permintaan tidak ditemukan, bukan milik wallet ini, atau sudah tidak berstatus menunggu.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[server.js] Error /api/topup/cancel:', err);
    res.status(500).json({ error: 'Gagal membatalkan permintaan' });
  }
});

app.get('/api/topup/history/:wallet', (req, res) => {
  try {
    const history = db.getTopupHistoryByWallet(req.params.wallet);
    res.json({ history });
  } catch (err) {
    console.error('[server.js] Error /api/topup/history:', err);
    res.status(500).json({ error: 'Gagal mengambil riwayat top up' });
  }
});

app.get('/api/topup/status/:topupId', (req, res) => {
  try {
    const request = db.getTopupRequest(req.params.topupId);
    if (!request) {
      return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
    }
    res.json(request);
  } catch (err) {
    console.error('[server.js] Error /api/topup/status:', err);
    res.status(500).json({ error: 'Gagal mengambil status' });
  }
});

/**
 * GET /api/admin/topup/pending?token=...
 * Panel admin: lihat antrian top up yang menunggu konfirmasi.
 */
app.get('/api/admin/topup/pending', (req, res) => {
  try {
    if (!cekSesiValid(req.query.token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    res.json({ pending: db.getTopupPendingList() });
  } catch (err) {
    console.error('[server.js] Error /api/admin/topup/pending:', err);
    res.status(500).json({ error: 'Gagal mengambil antrian top up' });
  }
});

/**
 * POST /api/admin/topup/confirm
 * Body: { token, topupId }
 * Admin konfirmasi pembayaran Rupiah/QRIS sudah masuk (dicek manual di
 * mutasi bank) — barulah di sini USDT benar-benar dikirim ke user.
 */
app.post('/api/admin/topup/confirm', async (req, res) => {
  try {
    const { token, topupId } = req.body;
    if (!cekSesiValid(token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    if (!topupId) {
      return res.status(400).json({ error: 'topupId wajib diisi' });
    }

    const request = db.getTopupRequest(topupId);
    if (!request) {
      return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
    }
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: `Permintaan ini sudah berstatus ${request.status}, tidak bisa dikonfirmasi lagi` });
    }

    const txHash = await topup.executeTopUp(topupId, request.wallet_user, request.usdt_amount);
    db.tandaiTopupSukses(topupId, txHash);

    res.json({ success: true, txHash });
  } catch (err) {
    // Alasan teknis ASLI (termasuk "Stok USDT vault tidak cukup" dari
    // kontrak) sengaja HANYA dicatat di log server, TIDAK diteruskan
    // apa adanya ke tampilan panel admin — supaya kalau layar ini
    // ke-share/demo, tidak kelihatan seperti platform kekurangan dana.
    // Cek log VPS (pm2 logs ppob-api) kalau perlu tau alasan pastinya.
    console.error('[server.js] Error /api/admin/topup/confirm (alasan asli):', err.reason || err.message || err);
    res.status(500).json({ error: 'Konfirmasi belum bisa diproses. Cek kembali beberapa saat lagi.' });
  }
});

/**
 * GET /api/admin/topup/settings?token=...
 * POST /api/admin/topup/settings  Body: { token, minRupiah, maxRupiah }
 */
/** GET /api/topup/settings — PUBLIK, customer perlu tau batas min/max
 * sebelum mengisi form. Data ini tidak sensitif (bukan angka uang
 * beneran, cuma batasan), jadi sengaja tidak butuh token admin. */
app.get('/api/topup/settings', (req, res) => {
  try {
    res.json({
      minRupiah: db.getTopupSetting('min_rupiah') || 50000,
      maxRupiah: db.getTopupSetting('max_rupiah') || 100000,
    });
  } catch (err) {
    console.error('[server.js] Error GET /api/topup/settings:', err);
    res.status(500).json({ error: 'Gagal mengambil pengaturan top up' });
  }
});

app.get('/api/admin/topup/settings', (req, res) => {
  try {
    if (!cekSesiValid(req.query.token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    res.json({
      minRupiah: db.getTopupSetting('min_rupiah') || 50000,
      maxRupiah: db.getTopupSetting('max_rupiah') || 100000,
    });
  } catch (err) {
    console.error('[server.js] Error GET /api/admin/topup/settings:', err);
    res.status(500).json({ error: 'Gagal mengambil pengaturan top up' });
  }
});

app.post('/api/admin/topup/settings', (req, res) => {
  try {
    const { token, minRupiah, maxRupiah } = req.body;
    if (!cekSesiValid(token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    const min = Number(minRupiah);
    const max = Number(maxRupiah);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max <= min) {
      return res.status(400).json({ error: 'minRupiah/maxRupiah tidak valid (max harus lebih besar dari min)' });
    }
    db.setTopupSetting('min_rupiah', min);
    db.setTopupSetting('max_rupiah', max);
    res.json({ success: true, minRupiah: min, maxRupiah: max });
  } catch (err) {
    console.error('[server.js] Error POST /api/admin/topup/settings:', err);
    res.status(500).json({ error: 'Gagal simpan pengaturan top up' });
  }
});

/**
 * GET /api/admin/topup/fee-tiers?token=...
 * POST /api/admin/topup/fee-tiers  Body: { token, action, id?, dariRupiah, sampaiRupiah, feeRupiah }
 * action: 'tambah' | 'ubah' | 'hapus'
 */
app.get('/api/admin/topup/fee-tiers', (req, res) => {
  try {
    if (!cekSesiValid(req.query.token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    res.json({ tiers: db.getTopupFeeTiers() });
  } catch (err) {
    console.error('[server.js] Error GET /api/admin/topup/fee-tiers:', err);
    res.status(500).json({ error: 'Gagal mengambil daftar fee tier' });
  }
});

app.post('/api/admin/topup/fee-tiers', (req, res) => {
  try {
    const { token, action, id, dariRupiah, sampaiRupiah, feeRupiah } = req.body;
    if (!cekSesiValid(token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }

    if (action === 'hapus') {
      if (!id) return res.status(400).json({ error: 'id wajib diisi untuk hapus' });
      db.hapusTopupFeeTier(id);
      return res.json({ success: true });
    }

    const dari = Number(dariRupiah);
    const sampai = sampaiRupiah === null || sampaiRupiah === '' ? null : Number(sampaiRupiah);
    const fee = Number(feeRupiah);
    if (!Number.isInteger(dari) || dari < 0 || !Number.isInteger(fee) || fee < 0) {
      return res.status(400).json({ error: 'dariRupiah/feeRupiah tidak valid' });
    }
    if (sampai !== null && (!Number.isInteger(sampai) || sampai <= dari)) {
      return res.status(400).json({ error: 'sampaiRupiah harus lebih besar dari dariRupiah, atau dikosongkan' });
    }

    if (action === 'ubah') {
      if (!id) return res.status(400).json({ error: 'id wajib diisi untuk ubah' });
      db.ubahTopupFeeTier(id, dari, sampai, fee);
    } else {
      db.tambahTopupFeeTier(dari, sampai, fee);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[server.js] Error POST /api/admin/topup/fee-tiers:', err);
    res.status(500).json({ error: 'Gagal simpan fee tier' });
  }
});

/** GET /api/admin/topup/vault-balance?token=... — saldo USDT di TopUpVault */
app.get('/api/admin/topup/vault-balance', async (req, res) => {
  try {
    if (!cekSesiValid(req.query.token)) {
      return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
    }
    const balance = await topup.getVaultBalance();
    res.json({ balance });
  } catch (err) {
    console.error('[server.js] Error /api/admin/topup/vault-balance:', err);
    res.status(500).json({ error: 'Gagal mengambil saldo vault' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', priceSigner: pricing.priceSignerAddress }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server.js] API berjalan di port ${PORT}`);
  console.log(`[server.js] Price Signer address: ${pricing.priceSignerAddress}`);
});
