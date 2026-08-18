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
function upsertProduct(kodeProduk, namaProduk, brand, category, type, deskripsi, hargaModal, isPascabayar, sellerStatus, komisi) {
  db.prepare(`
    INSERT INTO products (kode_produk, nama_produk, brand, category, type, deskripsi, harga_modal, is_pascabayar, seller_status, komisi, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kode_produk) DO UPDATE SET
      nama_produk = excluded.nama_produk,
      category = excluded.category,
      type = excluded.type,
      deskripsi = excluded.deskripsi,
      harga_modal = excluded.harga_modal,
      is_pascabayar = excluded.is_pascabayar,
      seller_status = excluded.seller_status,
      komisi = excluded.komisi,
      updated_at = excluded.updated_at
  `).run(kodeProduk, namaProduk, brand, category, type, deskripsi, hargaModal, isPascabayar ? 1 : 0, sellerStatus, komisi || 0, Date.now());
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

module.exports = {
  registerOrder,
  getOrderMeta,
  updateDigiflazzStatus,
  updateOnchainStatus,
  incrementRetry,
  getPendingOrders,
  getOrderHistoryByWallet,
  getProduct,
  upsertProduct,
  setHargaJualManual,
  setHargaReferensi,
  setBiayaAdminTambahan,
  getAllProducts,
  incrementStat,
  getStat,
  saveInquiry,
  getInquiry,
  nonaktifkanProdukHilang,
};
