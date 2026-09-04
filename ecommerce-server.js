/**
 * ecommerce-server.js
 * API untuk fitur E-Commerce INDOCOIN — quote harga, submit order,
 * katalog produk, dan aksi panel admin (terima/tolak/lapor/resi).
 *
 * Gerbang admin: endpoint /api/admin/* memverifikasi wallet pemanggil
 * ada di daftar isAdmin on-chain (dicek lewat ecommerce-blockchain.js),
 * BUKAN cuma dicek di frontend — konsisten dengan pola dev-panel.html
 * (server yang jadi penjaga sebenarnya, bukan tampilan).
 */

const express = require('express');
const { ethers } = require('ethers');
require('dotenv').config();

const db = require('./ecommerce-db');
const pricing = require('./ecommerce-pricing');
const fetcher = require('./ecommerce-fetcher');
const chain = require('./ecommerce-blockchain');

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-wallet-address');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

const KURS_USDT_IDR_FALLBACK = Number(process.env.KURS_USDT_IDR_FALLBACK || 15750);

async function ambilKursUsdtIdr() {
  // TODO: sambungkan ke sumber kurs yang sama dipakai fitur lain
  // (mis. ambilKursUsdtIdrServer() di ppob-server.js) supaya konsisten
  // satu platform, satu kurs — jangan biarkan 2 sumber kurs beda jalan
  // sendiri-sendiri.
  return KURS_USDT_IDR_FALLBACK;
}

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE — verifikasi admin (on-chain, bukan cuma tampilan)
// ─────────────────────────────────────────────────────────────────

async function verifikasiAdmin(req, res, next) {
  const wallet = req.headers['x-wallet-address'];
  if (!wallet || !ethers.isAddress(wallet)) {
    return res.status(401).json({ error: 'Wallet tidak valid' });
  }
  try {
    const isAdmin = await chain.contract.isAdmin(wallet);
    const owner = await chain.contract.owner();
    if (!isAdmin && wallet.toLowerCase() !== owner.toLowerCase()) {
      return res.status(403).json({ error: 'Bukan admin' });
    }
    req.adminWallet = wallet;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Gagal verifikasi admin', detail: err.message });
  }
}

async function verifikasiDev(req, res, next) {
  const wallet = req.headers['x-wallet-address'];
  if (!wallet || !ethers.isAddress(wallet)) {
    return res.status(401).json({ error: 'Wallet tidak valid' });
  }
  try {
    const owner = await chain.contract.owner();
    if (wallet.toLowerCase() !== owner.toLowerCase()) {
      return res.status(403).json({ error: 'Hanya Dev yang boleh mengatur ini' });
    }
    req.devWallet = wallet;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Gagal verifikasi Dev', detail: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// PRODUK — fetch dari link (paste-link bebas)
// ─────────────────────────────────────────────────────────────────

app.post('/api/produk/fetch', async (req, res) => {
  const { link } = req.body;
  if (!link) return res.status(400).json({ error: 'link wajib diisi' });

  const hasil = await fetcher.fetchDetailProduk(link);
  if (!hasil.berhasil) {
    return res.json({ berhasil: false, alasan: hasil.alasan });
  }
  res.json({ berhasil: true, data: hasil.data });
});

// ─────────────────────────────────────────────────────────────────
// KATALOG UNGGULAN
// ─────────────────────────────────────────────────────────────────

app.get('/api/katalog', (req, res) => {
  const { kategori } = req.query;
  const list = db.ambilKatalogAktif(kategori);
  res.json(list.map((p) => ({
    ...p,
    foto_url: JSON.parse(p.foto_url || '[]'),
  })));
});

app.post('/api/admin/katalog/tambah', verifikasiAdmin, async (req, res) => {
  const { link, kategori } = req.body;
  if (!link) return res.status(400).json({ error: 'link wajib diisi' });

  const platform = fetcher.deteksiPlatform(link);
  if (!platform) return res.status(400).json({ error: 'Link bukan dari Shopee/Tokopedia' });

  db.tambahKatalog({ linkProduk: link, platform, kategori });

  const hasil = await fetcher.fetchDetailProduk(link, false);
  if (hasil.berhasil) {
    db.updateDetailKatalog(link, {
      namaProduk: hasil.data.namaProduk,
      deskripsi: hasil.data.deskripsi,
      fotoUrl: hasil.data.fotoUrl,
      hargaModal: hasil.data.hargaModal,
      namaToko: hasil.data.namaToko,
      rating: hasil.data.rating,
      stokStatus: hasil.data.stokStatus,
    });
  } else {
    db.tandaiKatalogGagalFetch(link);
  }

  res.json({ sukses: true, autoFetchBerhasil: hasil.berhasil });
});

/**
 * Isi/perbarui detail produk MANUAL — dipakai selama ecommerce-fetcher.js
 * belum lengkap (atau kapan pun admin mau override hasil auto-fetch).
 */
app.post('/api/admin/katalog/manual', verifikasiAdmin, (req, res) => {
  const { link, namaProduk, deskripsi, fotoUrl, hargaModal, namaToko } = req.body;
  if (!link || !namaProduk || !hargaModal) {
    return res.status(400).json({ error: 'link, namaProduk, dan hargaModal wajib diisi' });
  }
  db.updateDetailKatalog(link, {
    namaProduk,
    deskripsi: deskripsi || '',
    fotoUrl: Array.isArray(fotoUrl) ? fotoUrl : (fotoUrl ? [fotoUrl] : []),
    hargaModal: Number(hargaModal),
    namaToko: namaToko || '',
    stokStatus: 'tersedia',
  });
  res.json({ sukses: true });
});

app.post('/api/admin/katalog/hapus', verifikasiAdmin, (req, res) => {
  const { link } = req.body;
  db.hapusKatalog(link);
  res.json({ sukses: true });
});

/// Fee manual per produk katalog — KHUSUS gerbang wallet Dev (bukan admin biasa),
/// sesuai kesepakatan "cuma Dev yang bisa lihat tombolnya".
app.post('/api/dev/katalog/set-fee', verifikasiDev, (req, res) => {
  const { link, feeManual } = req.body;
  db.setFeeManualKatalog(link, feeManual === null ? null : Number(feeManual));
  res.json({ sukses: true });
});

// ─────────────────────────────────────────────────────────────────
// QUOTE & CREATE ORDER
// ─────────────────────────────────────────────────────────────────

app.post('/api/quote', async (req, res) => {
  const { link, feeManual } = req.body;
  if (!link) return res.status(400).json({ error: 'link wajib diisi' });

  const hasilFetch = await fetcher.fetchDetailProduk(link);
  if (!hasilFetch.berhasil) {
    return res.json({ berhasil: false, alasan: hasilFetch.alasan });
  }

  const hargaModal = hasilFetch.data.hargaModal;
  const feeInfo = pricing.hitungFeeEcommerce(hargaModal, feeManual ?? null);
  if (!feeInfo.diizinkan) {
    return res.json({ berhasil: false, alasan: feeInfo.alasanTolak });
  }

  const kurs = await ambilKursUsdtIdr();
  const modalUsdt = pricing.rupiahKeUsdt18(hargaModal, kurs);
  const profitUsdt = pricing.rupiahKeUsdt18(feeInfo.fee, kurs);

  res.json({
    berhasil: true,
    produk: hasilFetch.data,
    hargaModal,
    fee: feeInfo.fee,
    hargaTotal: feeInfo.hargaTotal,
    modalUsdt: modalUsdt.toString(),
    profitUsdt: profitUsdt.toString(),
    kursUsdtIdr: kurs,
  });
});

/**
 * items: [{ link, hargaModal, fee }, ...] — hasil dari beberapa kali
 * panggilan /api/quote sebelumnya (satu per produk di keranjang).
 * Server yang hitung ulang & jumlahkan totalnya sendiri (jangan percaya
 * total dari frontend begitu saja) sebelum menandatangani quote gabungan.
 */
app.post('/api/orders/register', async (req, res) => {
  const { orderId, userWallet, items, alamatPenerima, sumber } = req.body;

  if (!orderId || !userWallet || !Array.isArray(items) || !items.length || !alamatPenerima) {
    return res.status(400).json({ error: 'Field wajib belum lengkap' });
  }

  const itemsLengkap = items.map((it) => {
    const platform = fetcher.deteksiPlatform(it.link);
    const cached = db.ambilCache(it.link, 24 * 3600);
    return {
      link: it.link,
      platform,
      namaProduk: cached?.namaProduk || null,
      fotoUrl: cached?.fotoUrl || [],
      hargaModal: it.hargaModal,
      fee: it.fee,
    };
  });

  const hargaModalTotal = itemsLengkap.reduce((s, it) => s + it.hargaModal, 0);
  const feeTotal = itemsLengkap.reduce((s, it) => s + it.fee, 0);

  const cekLimit = pricing.hitungFeeEcommerce(hargaModalTotal, feeTotal); // dipakai cuma buat cek cap total, bukan hitung ulang fee
  if (hargaModalTotal + feeTotal > (Number(process.env.MAX_ORDER_RUPIAH || pricing.FEE_HARGA_MAX + pricing.FEE_MAX))) {
    return res.status(400).json({ error: 'Total keranjang melebihi batas maksimal order' });
  }

  db.simpanOrderBaru({ orderId, userWallet, items: itemsLengkap, alamatPenerima, sumber: sumber || 'paste_link' });

  const kurs = await ambilKursUsdtIdr();
  const modalUsdt = pricing.rupiahKeUsdt18(hargaModalTotal, kurs);
  const profitUsdt = pricing.rupiahKeUsdt18(feeTotal, kurs);

  // orderRef menyegel SEMUA link produk dalam keranjang (bukan cuma satu),
  // supaya quote ini terikat persis ke isi keranjang yang sedang di-checkout.
  const orderRef = pricing.buatOrderRef(itemsLengkap.map((it) => it.link).join(','), orderId);
  const { signature, expiry } = await pricing.signQuote(
    orderId, orderRef, modalUsdt, profitUsdt,
    process.env.ECOMMERCE_GATEWAY_ADDRESS
  );

  res.json({
    sukses: true, orderRef, signature, expiry,
    modalUsdt: modalUsdt.toString(), profitUsdt: profitUsdt.toString(),
    hargaModalTotal, feeTotal,
  });
});

// ─────────────────────────────────────────────────────────────────
// RIWAYAT USER
// ─────────────────────────────────────────────────────────────────

app.get('/api/orders/history/:wallet', (req, res) => {
  const orders = db.ambilOrderUser(req.params.wallet);
  res.json(orders.map((o) => ({
    ...o,
    foto_url: JSON.parse(o.foto_url || '[]'),
    alamat_penerima: JSON.parse(o.alamat_penerima || '{}'),
  })));
});

// ─────────────────────────────────────────────────────────────────
// PANEL ADMIN — aksi order
// ─────────────────────────────────────────────────────────────────

app.get('/api/admin/orders/pending', verifikasiAdmin, (req, res) => {
  const semua = db.db.prepare(`SELECT * FROM orders_meta WHERE onchain_status IN ('CREATED','PROCESSING') ORDER BY created_at ASC`).all();
  res.json(semua.map((o) => ({
    ...o,
    foto_url: JSON.parse(o.foto_url || '[]'),
    alamat_penerima: JSON.parse(o.alamat_penerima || '{}'),
  })));
});

app.post('/api/admin/orders/proses', verifikasiAdmin, async (req, res) => {
  const { orderId, isCOD } = req.body;
  try {
    const txHash = await chain.startProcessing(orderId, !!isCOD);
    db.updateStatusOrder(orderId, 'PROCESSING', { isCOD: !!isCOD });
    res.json({ sukses: true, txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/orders/tolak', verifikasiAdmin, async (req, res) => {
  const { orderId, alasan } = req.body;
  try {
    const txHash = await chain.rejectOrder(orderId);
    db.updateStatusOrder(orderId, 'REFUNDED', { alasanReject: alasan });
    res.json({ sukses: true, txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/orders/resi', verifikasiAdmin, (req, res) => {
  const { orderId, resi, ekspedisi, buktiPembelianUrl } = req.body;
  db.updateStatusOrder(orderId, db.ambilOrder(orderId)?.onchain_status || 'PROCESSING', {
    resi, ekspedisi, buktiPembelianUrl,
  });
  res.json({ sukses: true });
});

app.post('/api/admin/orders/lapor-sukses', verifikasiAdmin, async (req, res) => {
  const { orderId } = req.body;
  try {
    const txHash = await chain.reportSuccess(orderId);
    db.updateStatusOrder(orderId, 'SUCCESS');
    res.json({ sukses: true, txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/orders/lapor-gagal', verifikasiAdmin, async (req, res) => {
  const { orderId, alasan } = req.body;
  try {
    const txHash = await chain.reportFailed(orderId);
    db.updateStatusOrder(orderId, 'REFUNDED', { alasanReject: alasan });
    res.json({ sukses: true, txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// LISTENER EVENT ON-CHAIN — sinkronkan status lokal begitu ada
// perubahan on-chain (termasuk yang dipicu buyer sendiri: cancel,
// confirmCODReceived/Rejected, atau refundExpired oleh siapa pun).
// ─────────────────────────────────────────────────────────────────

chain.listenForOrders((order) => {
  console.log('[ecommerce-server.js] Order baru masuk:', order.orderId);
  // Data lengkap (link, alamat) sudah masuk lewat /api/orders/register
  // sebelumnya (dipanggil frontend tepat sebelum user submit tx) — di
  // sini cukup log & (opsional) trigger notifikasi ke admin.
});

chain.listenForCODConfirmations(
  (ev) => {
    db.updateStatusOrder(ev.orderId, 'SUCCESS');
  },
  (ev) => {
    db.updateStatusOrder(ev.orderId, 'REFUNDED', { alasanReject: 'COD ditolak buyer' });
  }
);

// ─────────────────────────────────────────────────────────────────
// CRON — alert eskalasi (jam 6 & 12 di PROCESSING) & auto-mark diterima
// ─────────────────────────────────────────────────────────────────

async function jalankanCronAlert() {
  const semua = db.db.prepare(`SELECT * FROM orders_meta WHERE onchain_status = 'PROCESSING'`).all();
  for (const o of semua) {
    try {
      const elapsed = await chain.getProcessingElapsedSeconds(o.order_id);
      if (elapsed >= 12 * 3600 && !db.sudahDikirimAlert(o.order_id, 2)) {
        // TODO: kirim notifikasi MENDESAK ke admin (Telegram bot dll)
        db.catatAlertTerkirim(o.order_id, 2);
      } else if (elapsed >= 6 * 3600 && !db.sudahDikirimAlert(o.order_id, 1)) {
        // TODO: kirim notifikasi halus ke admin
        db.catatAlertTerkirim(o.order_id, 1);
      }
    } catch (err) {
      console.warn('[cron-alert] gagal cek order', o.order_id, err.message);
    }
  }
}

function jalankanCronAutoDiterima() {
  const perlu = db.ambilOrderPerluAutoDiterima();
  for (const o of perlu) {
    db.tandaiAutoDiterima(o.order_id); // display-only, tidak sentuh dana
  }
}

setInterval(jalankanCronAlert, 15 * 60 * 1000);       // tiap 15 menit
setInterval(jalankanCronAutoDiterima, 60 * 60 * 1000); // tiap 1 jam
setInterval(fetcher.refreshKatalog, 6 * 3600 * 1000);  // tiap 6 jam

const PORT = process.env.ECOMMERCE_PORT || 4100;
app.listen(PORT, () => {
  console.log(`[ecommerce-server.js] Jalan di port ${PORT}`);
});
