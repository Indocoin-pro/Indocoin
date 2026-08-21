/**
 * db.js
 * Database lokal (SQLite) — menyimpan data yang SENGAJA tidak ditaruh
 * on-chain demi privasi: nomor HP/nomor meteran tujuan, status proses
 * Digiflazz, dan riwayat percobaan.
 *
 * Kontrak PPOBGateway hanya tahu: orderId, kode produk, jumlah bayar.
 * Database ini yang menjembatani "orderId ini nomor tujuannya apa".
 */

const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './ppob.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS order_meta (
    order_id       TEXT PRIMARY KEY,
    customer_no    TEXT NOT NULL,
    product_code   TEXT NOT NULL,
    ref_id         TEXT,
    digiflazz_status TEXT DEFAULT 'PENDING',
    onchain_status TEXT DEFAULT 'CREATED',
    retry_count    INTEGER DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_digiflazz_status ON order_meta(digiflazz_status);
  CREATE INDEX IF NOT EXISTS idx_onchain_status ON order_meta(onchain_status);

  -- Katalog produk hasil sync dari Digiflazz (price-list API).
  -- Diisi terpisah oleh script sync (lihat sync-catalog.js), BUKAN
  -- di-fetch langsung tiap ada quote request — sesuai anjuran resmi
  -- Digiflazz untuk tidak memanggil price-list berulang-ulang.
  --
  -- Model harga (disederhanakan):
  --   - Default: harga_jual = harga_modal (apa adanya dari Digiflazz,
  --     TANPA markup) sampai Dev mengisi harga_jual_manual lewat admin
  --     panel. Produk TETAP tampil & bisa dibeli selama masa ini —
  --     bukan disembunyikan, cuma belum ada margin.
  --   - is_pascabayar: true untuk kategori "Pascabayar" — TIDAK PERNAH
  --     dimarkup manual, komisi didapat langsung dari Digiflazz.
  CREATE TABLE IF NOT EXISTS products (
    kode_produk        TEXT PRIMARY KEY,
    nama_produk        TEXT,
    brand              TEXT,
    category           TEXT,
    type               TEXT,
    deskripsi          TEXT,
    harga_modal        INTEGER NOT NULL,
    harga_jual_manual  INTEGER DEFAULT NULL,
    harga_referensi    INTEGER DEFAULT NULL,
    is_pascabayar      INTEGER DEFAULT 0,
    seller_status      TEXT DEFAULT 'unknown',
    updated_at         INTEGER NOT NULL
  );

  -- Angka akumulasi yang backend catat sendiri secara real-time (bukan
  -- dihitung ulang dari riwayat blockchain) — dipakai untuk kartu
  -- "Sudah Terpakai" di dashboard transparansi pool.
  CREATE TABLE IF NOT EXISTS stats (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL DEFAULT 0
  );

  -- Hasil "cek tagihan" (inq-pasca) pascabayar — WAJIB disimpan karena
  -- pembayaran (pay-pasca) harus pakai ref_id yang SAMA PERSIS dan di
  -- HARI YANG SAMA (aturan resmi Digiflazz). order_id di sini = ref_id
  -- yang dikirim ke Digiflazz = orderId on-chain (satu ID dipakai 3x).
  CREATE TABLE IF NOT EXISTS pasca_inquiries (
    order_id              TEXT PRIMARY KEY,
    kode_produk           TEXT NOT NULL,
    customer_no           TEXT NOT NULL,
    customer_name         TEXT,
    harga_asli            INTEGER NOT NULL,
    admin_digiflazz       INTEGER NOT NULL,
    komisi_digiflazz      INTEGER NOT NULL DEFAULT 0,
    biaya_admin_tambahan  INTEGER NOT NULL DEFAULT 0,
    total_bayar           INTEGER NOT NULL,
    created_at            INTEGER NOT NULL
  );
`);

// Migrasi manual — CREATE TABLE IF NOT EXISTS TIDAK menambah kolom baru
// ke tabel yang sudah ada sebelumnya, jadi kolom baru wajib ditambah
// lewat ALTER TABLE terpisah. Dibungkus try-catch supaya aman dijalankan
// berkali-kali (kalau kolom sudah ada, errornya diabaikan begitu saja).
try {
  db.exec(`ALTER TABLE products ADD COLUMN harga_referensi INTEGER DEFAULT NULL;`);
  console.log('[db.js] Migrasi: kolom harga_referensi ditambahkan.');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) {
    console.error('[db.js] Migrasi harga_referensi gagal:', err.message);
  }
}

// Biaya admin tambahan — KHUSUS produk pascabayar, angka yang Dev bisa
// tambahkan di atas biaya admin asli dari Digiflazz (atau isi dari nol
// kalau produk itu memang tidak ada biaya admin sama sekali).
try {
  db.exec(`ALTER TABLE products ADD COLUMN biaya_admin_tambahan INTEGER DEFAULT NULL;`);
  console.log('[db.js] Migrasi: kolom biaya_admin_tambahan ditambahkan.');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) {
    console.error('[db.js] Migrasi biaya_admin_tambahan gagal:', err.message);
  }
}

// Komisi — KHUSUS pascabayar, field TERPISAH dari "admin" yang selama
// ini kelewat tidak disimpan (Digiflazz kirim admin & commission
// sebagai 2 angka BEDA di /daftar-harga). Komisi ini yang jadi margin
// kita, ikut masuk ke profitUsdt (Buyback/Redemption/Operasional/Burn).
try {
  db.exec(`ALTER TABLE products ADD COLUMN komisi INTEGER DEFAULT 0;`);
  console.log('[db.js] Migrasi: kolom komisi ditambahkan.');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) {
    console.error('[db.js] Migrasi komisi gagal:', err.message);
  }
}

// Jadwal cut off RESMI dari Digiflazz sendiri (field start_cut_off /
// end_cut_off di response price-list mereka) — disimpan format "HH:MM"
// PERSIS seperti yang Digiflazz kirim. Dipakai untuk tandai produk
// SEBELUM ada yang sempat gagal beli, bukan reaktif seperti rc:69.
try {
  db.exec(`ALTER TABLE products ADD COLUMN start_cut_off TEXT;`);
  db.exec(`ALTER TABLE products ADD COLUMN end_cut_off TEXT;`);
  console.log('[db.js] Migrasi: kolom start_cut_off/end_cut_off ditambahkan.');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) {
    console.error('[db.js] Migrasi cut off gagal:', err.message);
  }
}

try {
  db.exec(`ALTER TABLE pasca_inquiries ADD COLUMN komisi_digiflazz INTEGER DEFAULT 0;`);
  console.log('[db.js] Migrasi: kolom pasca_inquiries.komisi_digiflazz ditambahkan.');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) {
    console.error('[db.js] Migrasi komisi_digiflazz gagal:', err.message);
  }
}

// wallet_user — dibutuhkan fitur Riwayat Pesanan, supaya bisa filter
// "pesanan siapa saja ini" per wallet yang connect ke frontend.
try {
  db.exec(`ALTER TABLE order_meta ADD COLUMN wallet_user TEXT;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wallet_user ON order_meta(wallet_user);`);
  console.log('[db.js] Migrasi: kolom order_meta.wallet_user ditambahkan.');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) {
    console.error('[db.js] Migrasi wallet_user gagal:', err.message);
  }
}

// sn — kode bukti transaksi (Serial Number) dari Digiflazz. Penting
// terutama untuk kasus beli pulsa/produk untuk NOMOR ORANG LAIN — user
// butuh bukti konkret transaksi itu benar-benar berhasil dikirim.
// Sebelumnya cuma dicatat ke log server, tidak pernah disimpan.
try {
  db.exec(`ALTER TABLE order_meta ADD COLUMN sn TEXT;`);
  console.log('[db.js] Migrasi: kolom order_meta.sn ditambahkan.');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) {
    console.error('[db.js] Migrasi sn gagal:', err.message);
  }
}

// last_error — pesan error ASLI (termasuk isi respons Digiflazz kalau
// ada) saat topup()/checkStatus() gagal dipanggil. Sebelumnya cuma
// err.message generic ("Request failed with status code 400") yang
// tersimpan di log server dan hilang — bikin sulit didiagnosis belakangan.
try {
  db.exec(`ALTER TABLE order_meta ADD COLUMN last_error TEXT;`);
  console.log('[db.js] Migrasi: kolom order_meta.last_error ditambahkan.');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) {
    console.error('[db.js] Migrasi last_error gagal:', err.message);
  }
}

/**
 * Dipanggil endpoint pendaftaran order (server.js) — frontend WAJIB
 * memanggil ini sebelum/tepat setelah user submit transaksi on-chain,
 * supaya listener tahu nomor tujuan saat event OrderCreated terdeteksi.
 */
function registerOrder(orderId, customerNo, productCode, walletUser) {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO order_meta (order_id, customer_no, product_code, wallet_user, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET customer_no = excluded.customer_no, wallet_user = excluded.wallet_user
  `);
  stmt.run(orderId, customerNo, productCode, walletUser ? walletUser.toLowerCase() : null, now, now);
}

function getOrderMeta(orderId) {
  return db.prepare('SELECT * FROM order_meta WHERE order_id = ?').get(orderId);
}

function updateDigiflazzStatus(orderId, status, refId, sn) {
  db.prepare(`
    UPDATE order_meta SET digiflazz_status = ?, ref_id = ?, sn = ?, updated_at = ?
    WHERE order_id = ?
  `).run(status, refId, sn || null, Date.now(), orderId);
}

/**
 * Tandai order GAGAL TERKIRIM ke Digiflazz — dipanggil saat topup()/
 * checkStatus() melempar exception (bukan respons Digiflazz yang
 * ke-parse, misal HTTP 400/network error). Status ini SENGAJA dibedakan
 * dari 'PENDING' biasa (yang berarti Digiflazz SUDAH terima order dan
 * masih memprosesnya) — supaya nanti tombol refund manual di halaman
 * riwayat cuma boleh muncul untuk status ini, TIDAK untuk PENDING asli
 * (mencegah user refund order yang sebenarnya masih diproses normal,
 * yang bisa berujung kerugian ganda kalau produknya ternyata terkirim).
 *
 * PENTING: order tetap boleh di-retry otomatis oleh retryPendingOrders()
 * seperti biasa setelah ditandai ini — status GAGAL_KIRIM akan otomatis
 * tertimpa jadi 'Sukses'/'Gagal' kalau percobaan berikutnya ternyata
 * berhasil dapat respons asli dari Digiflazz.
 */
function markGagalKirim(orderId, errorDetail) {
  db.prepare(`
    UPDATE order_meta SET digiflazz_status = 'GAGAL_KIRIM', last_error = ?, updated_at = ?
    WHERE order_id = ?
  `).run(errorDetail ? String(errorDetail).slice(0, 2000) : null, Date.now(), orderId);
}

function updateOnchainStatus(orderId, status) {
  db.prepare(`
    UPDATE order_meta SET onchain_status = ?, updated_at = ?
    WHERE order_id = ?
  `).run(status, Date.now(), orderId);
}

function incrementRetry(orderId) {
  db.prepare(`
    UPDATE order_meta SET retry_count = retry_count + 1, updated_at = ?
    WHERE order_id = ?
  `).run(Date.now(), orderId);
}

/**
 * Cari order yang statusnya masih menggantung (belum dilaporkan ke
 * on-chain) — dipakai saat listener restart, supaya order yang
 * "terlewat" pas server down bisa diproses ulang.
 */
function getPendingOrders() {
  return db.prepare(`
    SELECT * FROM order_meta
    WHERE onchain_status = 'CREATED'
    ORDER BY created_at ASC
  `).all();
}

/**
 * Riwayat pesanan milik 1 wallet — dipakai fitur Riwayat di frontend.
 * Gabung dengan products (nama produk) dan pasca_inquiries (harga
 * pascabayar yang sebenarnya, karena harganya dinamis per cek tagihan,
 * beda dari harga katalog statis).
 */
function getOrderHistoryByWallet(walletUser) {
  return db.prepare(`
    SELECT
      om.order_id, om.customer_no, om.product_code,
      om.digiflazz_status, om.onchain_status, om.created_at, om.sn,
      om.last_error, om.retry_count,
      p.nama_produk,
      COALESCE(p.harga_jual_manual, p.harga_modal) AS harga_prabayar,
      pi.total_bayar AS harga_pascabayar
    FROM order_meta om
    LEFT JOIN products p ON p.kode_produk = om.product_code
    LEFT JOIN pasca_inquiries pi ON pi.order_id = om.order_id
    WHERE om.wallet_user = ?
    ORDER BY om.created_at DESC
    LIMIT 50
  `).all(walletUser);
}

function getProduct(kodeProduk) {
  return db.prepare('SELECT * FROM products WHERE kode_produk = ?').get(kodeProduk);
}

/**
 * Sync ulang data dari Digiflazz — SENGAJA tidak menyentuh kolom
 * harga_jual_manual sama sekali, supaya harga yang sudah diatur Dev
 * tidak pernah tertimpa oleh sync berkala.
 */
function upsertProduct(kodeProduk, namaProduk, brand, category, type, deskripsi, hargaModal, isPascabayar, sellerStatus, komisi, startCutOff, endCutOff) {
  db.prepare(`
    INSERT INTO products (kode_produk, nama_produk, brand, category, type, deskripsi, harga_modal, is_pascabayar, seller_status, komisi, start_cut_off, end_cut_off, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kode_produk) DO UPDATE SET
      nama_produk = excluded.nama_produk,
      category = excluded.category,
      type = excluded.type,
      deskripsi = excluded.deskripsi,
      harga_modal = excluded.harga_modal,
      is_pascabayar = excluded.is_pascabayar,
      seller_status = excluded.seller_status,
      komisi = excluded.komisi,
      start_cut_off = excluded.start_cut_off,
      end_cut_off = excluded.end_cut_off,
      updated_at = excluded.updated_at
  `).run(kodeProduk, namaProduk, brand, category, type, deskripsi, hargaModal, isPascabayar ? 1 : 0, sellerStatus, komisi || 0, startCutOff || null, endCutOff || null, Date.now());
}

/**
 * Cek apakah waktu SEKARANG (waktu server, WIB kalau VPS di-set WIB —
 * lihat catatan di bawah) berada di dalam jendela cut off produk ini.
 * Digiflazz kirim jam TANPA tanggal ("23:45"), dan kalau start > end
 * artinya jendelanya MELEWATI TENGAH MALAM (mis. 23:45 → 00:15) —
 * ditangani khusus di bawah.
 *
 * PENTING: ini asumsi jam server = WIB (zona waktu Digiflazz). Kalau
 * VPS di-set UTC, hasil ini akan meleset — cek `date` di VPS kalau ragu.
 */
function apakahSedangCutOff(startCutOff, endCutOff) {
  if (!startCutOff || !endCutOff || startCutOff === '00:00' && endCutOff === '00:00') return false;

  const sekarang = new Date();
  const menitSekarang = sekarang.getHours() * 60 + sekarang.getMinutes();

  const [sh, sm] = startCutOff.split(':').map(Number);
  const [eh, em] = endCutOff.split(':').map(Number);
  const menitStart = sh * 60 + sm;
  const menitEnd = eh * 60 + em;

  if (menitStart <= menitEnd) {
    // Jendela normal dalam 1 hari, mis. 08:00 - 09:00
    return menitSekarang >= menitStart && menitSekarang < menitEnd;
  } else {
    // Jendela melewati tengah malam, mis. 23:45 - 00:15
    return menitSekarang >= menitStart || menitSekarang < menitEnd;
  }
}

/**
 * Dipanggil admin panel (fitur mendatang) — Dev mengisi harga jual
 * manual untuk 1 produk. Kirim `null` untuk mengosongkan lagi (balik
 * pakai harga_modal apa adanya).
 */
function setHargaJualManual(kodeProduk, harga) {
  db.prepare(`
    UPDATE products SET harga_jual_manual = ?, updated_at = ?
    WHERE kode_produk = ?
  `).run(harga, Date.now(), kodeProduk);
}

/** Harga "dicoret" (referensi/perbandingan) — murni kosmetik, tidak
 * dipakai buat hitungan apapun, cuma ditampilkan ke user apa adanya. */
function setHargaReferensi(kodeProduk, harga) {
  db.prepare(`
    UPDATE products SET harga_referensi = ?, updated_at = ?
    WHERE kode_produk = ?
  `).run(harga, Date.now(), kodeProduk);
}

/** Khusus pascabayar — biaya admin TAMBAHAN yang Dev tentukan sendiri,
 * ditambahkan di atas biaya admin asli dari Digiflazz (kalau ada). */
function setBiayaAdminTambahan(kodeProduk, biaya) {
  db.prepare(`
    UPDATE products SET biaya_admin_tambahan = ?, updated_at = ?
    WHERE kode_produk = ?
  `).run(biaya, Date.now(), kodeProduk);
}

/**
 * Tandai produk yang TIDAK MUNCUL LAGI di hasil sync terbaru Digiflazz
 * sebagai 'invalid' (bukan dihapus permanen dari database — cuma
 * disembunyikan dari /api/catalog, karena getAllProducts() hanya
 * mengambil yang seller_status='valid'). Kalau Digiflazz aktifkan lagi
 * produk itu nanti, upsertProduct() otomatis balikin jadi 'valid' lagi.
 */
function nonaktifkanProdukHilang(kodeProdukAktifSaatIni) {
  if (kodeProdukAktifSaatIni.length === 0) return 0;
  const placeholder = kodeProdukAktifSaatIni.map(() => '?').join(',');
  const result = db.prepare(`
    UPDATE products SET seller_status = 'invalid', updated_at = ?
    WHERE seller_status = 'valid' AND kode_produk NOT IN (${placeholder})
  `).run(Date.now(), ...kodeProdukAktifSaatIni);
  return result.changes;
}

function getAllProducts() {
  return db.prepare(`
    SELECT kode_produk, nama_produk, brand, category, type, deskripsi, harga_modal, harga_jual_manual, harga_referensi, biaya_admin_tambahan, komisi, is_pascabayar
    FROM products
    WHERE seller_status = 'valid'
    ORDER BY category, brand, type, harga_modal ASC
  `).all();
}

function incrementStat(key, amount) {
  db.prepare(`
    INSERT INTO stats (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = value + excluded.value
  `).run(key, amount);
}

function getStat(key) {
  const row = db.prepare('SELECT value FROM stats WHERE key = ?').get(key);
  return row ? row.value : 0;
}

/** Simpan hasil "cek tagihan" — dipanggil dari /api/pasca/inquiry */
function saveInquiry({ orderId, kodeProduk, customerNo, customerName, hargaAsli, adminDigiflazz, komisiDigiflazz, biayaAdminTambahan, totalBayar }) {
  db.prepare(`
    INSERT INTO pasca_inquiries
      (order_id, kode_produk, customer_no, customer_name, harga_asli, admin_digiflazz, komisi_digiflazz, biaya_admin_tambahan, total_bayar, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(orderId, kodeProduk, customerNo, customerName, hargaAsli, adminDigiflazz, komisiDigiflazz || 0, biayaAdminTambahan, totalBayar, Date.now());
}

/** Ambil hasil cek tagihan — dipakai /api/quote (untuk hitung harga
 * dinamis) DAN ppob-listener.js (untuk deteksi "order ini pascabayar,
 * panggil payPasca() bukan topup()"). Return null kalau bukan order
 * pascabayar (tidak pernah melalui proses cek tagihan). */
function getInquiry(orderId) {
  return db.prepare('SELECT * FROM pasca_inquiries WHERE order_id = ?').get(orderId);
}

// ═══════════════════════════════════════════════════════════
// LIMIT HARIAN PEMBAYARAN INDC — supaya Dana Likuid (Redemption
// Vault) yang masih tipis nggak abis kesedot 1-2 wallet doang, tiap
// wallet dijatah maksimal 1x pembelian pakai INDC per hari. Dicatat
// SAAT quote diterbitkan (bukan saat order sukses) — sengaja begitu,
// karena quote itulah satu-satunya "tiket" yang bikin transaksi bisa
// diproses kontrak (lihat komentar di server.js /api/quote).
// ═══════════════════════════════════════════════════════════
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS indc_daily_limit (
      wallet  TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      order_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (wallet, tanggal)
    );
  `);
} catch (err) {
  console.error('[db.js] Migrasi indc_daily_limit gagal:', err.message);
}

function _tanggalHariIni() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, patokan UTC
}

/** true kalau wallet ini SUDAH pernah dapat quote INDC hari ini */
function sudahPakaiIndcHariIni(wallet) {
  const row = db.prepare('SELECT 1 FROM indc_daily_limit WHERE wallet = ? AND tanggal = ?')
    .get(wallet.toLowerCase(), _tanggalHariIni());
  return !!row;
}

/** Catat jatah INDC hari ini sudah terpakai oleh wallet ini */
function catatPakaiIndcHariIni(wallet, orderId) {
  db.prepare(`
    INSERT OR IGNORE INTO indc_daily_limit (wallet, tanggal, order_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(wallet.toLowerCase(), _tanggalHariIni(), orderId || null, Date.now());
}

// ═══════════════════════════════════════════════════════════
// TOP UP USDT PAKAI RUPIAH/QRIS
// ═══════════════════════════════════════════════════════════

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topup_requests (
      topup_id       TEXT PRIMARY KEY,
      wallet_user    TEXT NOT NULL,
      nominal_rupiah INTEGER NOT NULL,
      kode_unik      TEXT NOT NULL,
      fee_rupiah     INTEGER NOT NULL,
      usdt_amount    REAL NOT NULL,
      status         TEXT DEFAULT 'PENDING',
      tx_hash        TEXT,
      created_at     INTEGER NOT NULL,
      confirmed_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_topup_wallet ON topup_requests(wallet_user);
    CREATE INDEX IF NOT EXISTS idx_topup_status ON topup_requests(status);

    CREATE TABLE IF NOT EXISTS topup_fee_tiers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      dari_rupiah  INTEGER NOT NULL,
      sampai_rupiah INTEGER,  -- NULL berarti tak terbatas ke atas
      fee_rupiah   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topup_settings (
      kunci TEXT PRIMARY KEY,
      nilai TEXT NOT NULL
    );
  `);

  // Isi default HANYA kalau tabel masih benar-benar kosong (supaya tidak
  // menimpa pengaturan yang sudah diubah admin lewat panel)
  const jumlahTier = db.prepare('SELECT COUNT(*) as n FROM topup_fee_tiers').get().n;
  if (jumlahTier === 0) {
    const stmt = db.prepare('INSERT INTO topup_fee_tiers (dari_rupiah, sampai_rupiah, fee_rupiah) VALUES (?, ?, ?)');
    stmt.run(10000, 50000, 1000);     // Rp10rb - Rp50rb   → fee Rp1.000
    stmt.run(50001, 100000, 1700);    // Rp50rb - Rp100rb  → fee Rp1.700
    stmt.run(100001, 150000, 2300);   // Rp100rb - Rp150rb → fee Rp2.300
    stmt.run(150001, 200000, 3000);   // Rp150rb - Rp200rb → fee Rp3.000
  }

  const adaMin = db.prepare("SELECT 1 FROM topup_settings WHERE kunci = 'min_rupiah'").get();
  if (!adaMin) {
    db.prepare("INSERT INTO topup_settings (kunci, nilai) VALUES ('min_rupiah', '10000')").run();
  }
  const adaMax = db.prepare("SELECT 1 FROM topup_settings WHERE kunci = 'max_rupiah'").get();
  if (!adaMax) {
    db.prepare("INSERT INTO topup_settings (kunci, nilai) VALUES ('max_rupiah', '200000')").run();
  }
} catch (err) {
  console.error('[db.js] Migrasi tabel top up gagal:', err.message);
}

function getTopupSetting(kunci) {
  const row = db.prepare('SELECT nilai FROM topup_settings WHERE kunci = ?').get(kunci);
  return row ? Number(row.nilai) : null;
}

function setTopupSetting(kunci, nilai) {
  db.prepare(`
    INSERT INTO topup_settings (kunci, nilai) VALUES (?, ?)
    ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai
  `).run(kunci, String(nilai));
}

function getTopupFeeTiers() {
  return db.prepare('SELECT * FROM topup_fee_tiers ORDER BY dari_rupiah ASC').all();
}

function tambahTopupFeeTier(dariRupiah, sampaiRupiah, feeRupiah) {
  db.prepare('INSERT INTO topup_fee_tiers (dari_rupiah, sampai_rupiah, fee_rupiah) VALUES (?, ?, ?)')
    .run(dariRupiah, sampaiRupiah, feeRupiah);
}

function ubahTopupFeeTier(id, dariRupiah, sampaiRupiah, feeRupiah) {
  db.prepare('UPDATE topup_fee_tiers SET dari_rupiah = ?, sampai_rupiah = ?, fee_rupiah = ? WHERE id = ?')
    .run(dariRupiah, sampaiRupiah, feeRupiah, id);
}

function hapusTopupFeeTier(id) {
  db.prepare('DELETE FROM topup_fee_tiers WHERE id = ?').run(id);
}

/**
 * Cari fee yang cocok untuk nominal tertentu. Kalau tidak ada tier yang
 * cocok persis (mis. nominal di luar semua rentang yang didefinisikan),
 * fallback ke tier TERTINGGI supaya permintaan tidak pernah ditolak
 * hanya gara-gara konfigurasi tier kurang lengkap.
 */
function cariFeeUntukNominal(nominalRupiah) {
  const tiers = getTopupFeeTiers();
  if (tiers.length === 0) return 0;
  for (const t of tiers) {
    const cocokBawah = nominalRupiah >= t.dari_rupiah;
    const cocokAtas = t.sampai_rupiah === null || nominalRupiah <= t.sampai_rupiah;
    if (cocokBawah && cocokAtas) return t.fee_rupiah;
  }
  return tiers[tiers.length - 1].fee_rupiah; // fallback: tier tertinggi
}

/**
 * Cari 1 request PENDING yang masih aktif (belum lewat 30 menit) milik
 * wallet ini. Dipakai untuk menegakkan aturan "1 request aktif per wallet".
 * Request yang sudah lewat 30 menit dianggap EXPIRED di sini (lazy —
 * ditandai expired saat dicek, bukan lewat proses terpisah yang jalan
 * sendiri di background).
 */
function getTopupPendingAktif(wallet) {
  const batasWaktu = Date.now() - 30 * 60 * 1000;
  const row = db.prepare(`
    SELECT * FROM topup_requests
    WHERE wallet_user = ? AND status = 'PENDING' AND created_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(wallet.toLowerCase(), batasWaktu);

  // Tandai expired semua PENDING milik wallet ini yang sudah lewat waktu
  // (bukan cuma yang barusan dicek), supaya tabel tetap bersih dari
  // request basi setiap kali wallet ini berinteraksi lagi.
  db.prepare(`
    UPDATE topup_requests SET status = 'EXPIRED'
    WHERE wallet_user = ? AND status = 'PENDING' AND created_at <= ?
  `).run(wallet.toLowerCase(), batasWaktu);

  return row || null;
}

/** Cek apakah kode unik ini sudah kepakai request PENDING lain yang
 * masih aktif dengan nominal asli yang sama (nominal + kode unik yang
 * sama = angka transfer yang sama, bikin bingung dicocokkan manual). */
function kodeUnikSudahDipakai(nominalRupiah, kodeUnik) {
  const batasWaktu = Date.now() - 30 * 60 * 1000;
  const row = db.prepare(`
    SELECT 1 FROM topup_requests
    WHERE status = 'PENDING' AND created_at > ?
      AND nominal_rupiah = ? AND kode_unik = ?
  `).get(batasWaktu, nominalRupiah, kodeUnik);
  return !!row;
}

function buatTopupRequest({ topupId, wallet, nominalRupiah, kodeUnik, feeRupiah, usdtAmount }) {
  db.prepare(`
    INSERT INTO topup_requests (topup_id, wallet_user, nominal_rupiah, kode_unik, fee_rupiah, usdt_amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `).run(topupId, wallet.toLowerCase(), nominalRupiah, kodeUnik, feeRupiah, usdtAmount, Date.now());
}

function getTopupRequest(topupId) {
  return db.prepare('SELECT * FROM topup_requests WHERE topup_id = ?').get(topupId);
}

/** Riwayat top up milik 1 wallet, SEMUA status — dipakai riwayat.html.
 * Sekalian tandai yang sudah lewat 30 menit sebagai EXPIRED dulu, biar
 * status yang ditampilkan selalu akurat, bukan basi. */
function getTopupHistoryByWallet(wallet) {
  const batasWaktu = Date.now() - 30 * 60 * 1000;
  db.prepare(`UPDATE topup_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND created_at <= ? AND wallet_user = ?`)
    .run(batasWaktu, wallet.toLowerCase());
  return db.prepare('SELECT * FROM topup_requests WHERE wallet_user = ? ORDER BY created_at DESC')
    .all(wallet.toLowerCase());
}

/** Daftar antrian untuk panel admin — otomatis membersihkan status
 * expired dulu sebelum ditampilkan, supaya admin tidak lihat request
 * basi yang sebenarnya sudah lewat waktu. */
function getTopupPendingList() {
  const batasWaktu = Date.now() - 30 * 60 * 1000;
  db.prepare(`UPDATE topup_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND created_at <= ?`)
    .run(batasWaktu);
  return db.prepare(`SELECT * FROM topup_requests WHERE status = 'PENDING' ORDER BY created_at ASC`).all();
}

// ═══════════════════════════════════════════════════════════
// TANDA CUT OFF PRODUK (harga seller lebih tinggi dari batas buyer)
// ═══════════════════════════════════════════════════════════

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_cutoff_status (
      kode_produk TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'hijau', -- 'hijau' atau 'merah'
      last_error  TEXT,
      updated_at  INTEGER NOT NULL
    );
  `);
} catch (err) {
  console.error('[db.js] Migrasi tabel product_cutoff_status gagal:', err.message);
}

/** Tandai produk ini MERAH (cut off) — dipanggil listener saat deteksi
 * error rc:69 (harga seller > batas buyer). */
function tandaiCutOff(kodeProduk, errorDetail) {
  db.prepare(`
    INSERT INTO product_cutoff_status (kode_produk, status, last_error, updated_at)
    VALUES (?, 'merah', ?, ?)
    ON CONFLICT(kode_produk) DO UPDATE SET status = 'merah', last_error = excluded.last_error, updated_at = excluded.updated_at
  `).run(kodeProduk, errorDetail || null, Date.now());
}

/** Tandai produk ini HIJAU lagi — dipanggil otomatis begitu ada
 * transaksi produk ini yang SUKSES (self-healing), atau manual oleh
 * admin lewat panel kalau sudah yakin harga sudah dibetulkan duluan. */
function tandaiSuksesProduk(kodeProduk) {
  db.prepare(`
    INSERT INTO product_cutoff_status (kode_produk, status, last_error, updated_at)
    VALUES (?, 'hijau', NULL, ?)
    ON CONFLICT(kode_produk) DO UPDATE SET status = 'hijau', last_error = NULL, updated_at = excluded.updated_at
  `).run(kodeProduk, Date.now());
}

/** Ambil status SEMUA produk sekaligus (buat frontend, 1x fetch bukan
 * per-produk) — cuma balikin yang statusnya MERAH, biar payload kecil
 * (produk hijau itu default, tidak perlu dikirim satu-satu). */
function getSemuaProdukMerah() {
  const rows = db.prepare(`SELECT kode_produk, last_error, updated_at FROM product_cutoff_status WHERE status = 'merah'`).all();
  const map = {};
  rows.forEach(r => { map[r.kode_produk] = { lastError: r.last_error, updatedAt: r.updated_at }; });
  return map;
}

function tandaiSuksesProdukManual(kodeProduk) {
  tandaiSuksesProduk(kodeProduk);
}

function tandaiTopupSukses(topupId, txHash) {
  db.prepare(`
    UPDATE topup_requests SET status = 'SUKSES', tx_hash = ?, confirmed_at = ?
    WHERE topup_id = ?
  `).run(txHash, Date.now(), topupId);
}

/**
 * Batalkan permintaan top up milik SENDIRI (bukan lewat admin), supaya
 * user tidak terkunci nunggu 30 menit kalau ternyata cuma iseng lihat-
 * lihat atau berubah pikiran. Cuma boleh kalau statusnya masih PENDING
 * dan memang benar milik wallet yang minta — dicek dulu sebelum diubah.
 * @returns {boolean} true kalau berhasil dibatalkan, false kalau tidak
 * ditemukan/bukan miliknya/statusnya sudah bukan PENDING.
 */
function batalkanTopupRequest(topupId, wallet) {
  const request = getTopupRequest(topupId);
  if (!request) return false;
  if (request.wallet_user.toLowerCase() !== wallet.toLowerCase()) return false;
  if (request.status !== 'PENDING') return false;

  db.prepare(`UPDATE topup_requests SET status = 'DIBATALKAN' WHERE topup_id = ?`).run(topupId);
  return true;
}

module.exports = {
  registerOrder,
  getOrderMeta,
  updateDigiflazzStatus,
  markGagalKirim,
  updateOnchainStatus,
  incrementRetry,
  getPendingOrders,
  getOrderHistoryByWallet,
  getProduct,
  upsertProduct,
  apakahSedangCutOff,
  setHargaJualManual,
  setHargaReferensi,
  setBiayaAdminTambahan,
  getAllProducts,
  incrementStat,
  getStat,
  saveInquiry,
  getInquiry,
  sudahPakaiIndcHariIni,
  catatPakaiIndcHariIni,
  getTopupSetting,
  setTopupSetting,
  getTopupFeeTiers,
  tambahTopupFeeTier,
  ubahTopupFeeTier,
  hapusTopupFeeTier,
  cariFeeUntukNominal,
  getTopupPendingAktif,
  kodeUnikSudahDipakai,
  buatTopupRequest,
  getTopupRequest,
  getTopupHistoryByWallet,
  getTopupPendingList,
  tandaiTopupSukses,
  tandaiCutOff,
  tandaiSuksesProduk,
  getSemuaProdukMerah,
  tandaiSuksesProdukManual,
  batalkanTopupRequest,
  nonaktifkanProdukHilang,
};
