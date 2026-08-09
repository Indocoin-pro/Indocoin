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
    harga_modal        INTEGER NOT NULL,
    harga_jual_manual  INTEGER DEFAULT NULL,
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
`);

/**
 * Dipanggil endpoint pendaftaran order (server.js) — frontend WAJIB
 * memanggil ini sebelum/tepat setelah user submit transaksi on-chain,
 * supaya listener tahu nomor tujuan saat event OrderCreated terdeteksi.
 */
function registerOrder(orderId, customerNo, productCode) {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO order_meta (order_id, customer_no, product_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET customer_no = excluded.customer_no
  `);
  stmt.run(orderId, customerNo, productCode, now, now);
}

function getOrderMeta(orderId) {
  return db.prepare('SELECT * FROM order_meta WHERE order_id = ?').get(orderId);
}

function updateDigiflazzStatus(orderId, status, refId) {
  db.prepare(`
    UPDATE order_meta SET digiflazz_status = ?, ref_id = ?, updated_at = ?
    WHERE order_id = ?
  `).run(status, refId, Date.now(), orderId);
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

function getProduct(kodeProduk) {
  return db.prepare('SELECT * FROM products WHERE kode_produk = ?').get(kodeProduk);
}

/**
 * Sync ulang data dari Digiflazz — SENGAJA tidak menyentuh kolom
 * harga_jual_manual sama sekali, supaya harga yang sudah diatur Dev
 * tidak pernah tertimpa oleh sync berkala.
 */
function upsertProduct(kodeProduk, namaProduk, brand, category, hargaModal, isPascabayar, sellerStatus) {
  db.prepare(`
    INSERT INTO products (kode_produk, nama_produk, brand, category, harga_modal, is_pascabayar, seller_status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kode_produk) DO UPDATE SET
      nama_produk = excluded.nama_produk,
      category = excluded.category,
      harga_modal = excluded.harga_modal,
      is_pascabayar = excluded.is_pascabayar,
      seller_status = excluded.seller_status,
      updated_at = excluded.updated_at
  `).run(kodeProduk, namaProduk, brand, category, hargaModal, isPascabayar ? 1 : 0, sellerStatus, Date.now());
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

function getAllProducts() {
  return db.prepare(`
    SELECT kode_produk, nama_produk, brand, category, harga_modal, harga_jual_manual, is_pascabayar
    FROM products
    WHERE seller_status = 'valid'
    ORDER BY category, brand, harga_modal ASC
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

module.exports = {
  registerOrder,
  getOrderMeta,
  updateDigiflazzStatus,
  updateOnchainStatus,
  incrementRetry,
  getPendingOrders,
  getProduct,
  upsertProduct,
  setHargaJualManual,
  getAllProducts,
  incrementStat,
  getStat,
};
