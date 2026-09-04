/**
 * ecommerce-db.js
 * Database lokal (SQLite) untuk fitur E-Commerce — menyimpan data yang
 * SENGAJA tidak ditaruh on-chain: link produk, alamat pengiriman, detail
 * hasil fetch (foto/deskripsi/toko), resi, dan riwayat status.
 *
 * Kontrak EcommerceGateway hanya tahu: orderId, orderRef (hash link),
 * jumlah bayar, status. Database ini yang menjembatani "orderId ini
 * link produknya apa, dikirim ke alamat mana, resinya berapa".
 */

const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.ECOMMERCE_DB_PATH || './ecommerce.db');
db.pragma('journal_mode = WAL');

db.exec(`
  -- Data lengkap tiap order — jembatan antara orderId on-chain dan
  -- detail belanja yang gak pantas/gak perlu ditaruh di blockchain.
  CREATE TABLE IF NOT EXISTS orders_meta (
    order_id            TEXT PRIMARY KEY,
    user_wallet          TEXT NOT NULL,
    link_produk          TEXT NOT NULL,
    items_json            TEXT,                -- JSON array SEMUA produk dalam order ini (satu keranjang, bisa >1 item)
    platform              TEXT,               -- 'shopee' | 'tokopedia'
    nama_produk           TEXT,
    foto_url              TEXT,               -- JSON array string
    harga_modal           INTEGER NOT NULL,    -- Rupiah, TOTAL semua item (produk+ongkir)
    fee_admin             INTEGER NOT NULL,    -- Rupiah, TOTAL fee semua item
    alamat_penerima       TEXT NOT NULL,       -- JSON: nama, telp, alamat lengkap (SATU alamat utk semua item)
    sumber                TEXT DEFAULT 'paste_link', -- 'paste_link' | 'katalog'
    onchain_status        TEXT DEFAULT 'CREATED',
    is_cod                INTEGER DEFAULT 0,
    alasan_reject          TEXT,
    resi                  TEXT,
    ekspedisi              TEXT,
    bukti_pembelian_url    TEXT,
    ditandai_diterima_at   INTEGER,            -- auto-tandai 7 hari (non-COD, display only)
    created_at             INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_onchain_status ON orders_meta(onchain_status);
  CREATE INDEX IF NOT EXISTS idx_user_wallet ON orders_meta(user_wallet);

  -- Katalog produk unggulan (admin tempel link, sistem auto-lengkapi).
  -- Model margin: default fee dari kurva otomatis (ecommerce-pricing.js),
  -- fee_manual override kalau Dev sudah isi lewat panel (gerbang wallet Dev).
  CREATE TABLE IF NOT EXISTS katalog_produk (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    link_produk          TEXT NOT NULL UNIQUE,
    platform              TEXT,
    kategori              TEXT,
    nama_produk           TEXT,
    deskripsi             TEXT,
    foto_url              TEXT,               -- JSON array string
    harga_modal           INTEGER,             -- hasil fetch terakhir
    fee_manual            INTEGER DEFAULT NULL,
    nama_toko             TEXT,
    rating                REAL,
    stok_status            TEXT,
    aktif                  INTEGER DEFAULT 1,   -- admin bisa nonaktifkan/hapus dari tampilan
    fetch_gagal_terakhir   INTEGER DEFAULT 0,   -- flag fallback manual
    created_at             INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_katalog_kategori ON katalog_produk(kategori);
  CREATE INDEX IF NOT EXISTS idx_katalog_aktif ON katalog_produk(aktif);

  -- Cache hasil fetch produk (paste-link bebas) — cegah fetch ulang
  -- kalau ada 2 user paste link yang sama dalam waktu dekat.
  CREATE TABLE IF NOT EXISTS fetch_cache (
    link_produk    TEXT PRIMARY KEY,
    data_json      TEXT NOT NULL,
    fetched_at     INTEGER NOT NULL
  );

  -- Log alert eskalasi (jam 6 & 12 di status PROCESSING) — supaya
  -- backend tidak kirim notifikasi dobel untuk order & tingkat yang sama.
  CREATE TABLE IF NOT EXISTS alert_log (
    order_id     TEXT NOT NULL,
    tingkat      INTEGER NOT NULL,  -- 1 (jam 6) atau 2 (jam 12)
    sent_at      INTEGER NOT NULL,
    PRIMARY KEY (order_id, tingkat)
  );
`);

const now = () => Math.floor(Date.now() / 1000);

// ─────────────────────────────────────────────────────────────────
// ORDERS META
// ─────────────────────────────────────────────────────────────────

/**
 * @param {Array} items  [{ link, platform, namaProduk, fotoUrl, hargaModal, fee }, ...]
 *   Satu order bisa berisi >1 produk (satu keranjang), SELAMA satu alamat
 *   yang sama. hargaModal/feeAdmin yang disimpan di kolom utama = TOTAL
 *   dari seluruh item (buat tampilan ringkas riwayat & panel admin).
 */
function simpanOrderBaru({
  orderId, userWallet, items, alamatPenerima, sumber,
}) {
  const t = now();
  const hargaModalTotal = items.reduce((sum, it) => sum + it.hargaModal, 0);
  const feeTotal = items.reduce((sum, it) => sum + it.fee, 0);
  const itemPertama = items[0];

  db.prepare(`
    INSERT INTO orders_meta
      (order_id, user_wallet, link_produk, items_json, platform, nama_produk, foto_url,
       harga_modal, fee_admin, alamat_penerima, sumber, onchain_status,
       created_at, updated_at)
    VALUES (@orderId, @userWallet, @linkProduk, @itemsJson, @platform, @namaProduk, @fotoUrl,
       @hargaModal, @feeAdmin, @alamatPenerima, @sumber, 'CREATED', @t, @t)
  `).run({
    orderId, userWallet,
    linkProduk: itemPertama.link,
    itemsJson: JSON.stringify(items),
    platform: itemPertama.platform,
    namaProduk: items.length > 1 ? `${itemPertama.namaProduk} +${items.length - 1} lainnya` : itemPertama.namaProduk,
    fotoUrl: JSON.stringify(itemPertama.fotoUrl || []),
    hargaModal: hargaModalTotal,
    feeAdmin: feeTotal,
    alamatPenerima: JSON.stringify(alamatPenerima),
    sumber: sumber || 'paste_link',
    t,
  });
}

function updateStatusOrder(orderId, status, extra = {}) {
  const fields = ['onchain_status = @status', 'updated_at = @t'];
  const params = { orderId, status, t: now() };

  if (extra.isCOD !== undefined) { fields.push('is_cod = @isCOD'); params.isCOD = extra.isCOD ? 1 : 0; }
  if (extra.alasanReject) { fields.push('alasan_reject = @alasanReject'); params.alasanReject = extra.alasanReject; }
  if (extra.resi) { fields.push('resi = @resi'); params.resi = extra.resi; }
  if (extra.ekspedisi) { fields.push('ekspedisi = @ekspedisi'); params.ekspedisi = extra.ekspedisi; }
  if (extra.buktiPembelianUrl) { fields.push('bukti_pembelian_url = @buktiPembelianUrl'); params.buktiPembelianUrl = extra.buktiPembelianUrl; }

  db.prepare(`UPDATE orders_meta SET ${fields.join(', ')} WHERE order_id = @orderId`).run(params);
}

function tandaiAutoDiterima(orderId) {
  db.prepare(`UPDATE orders_meta SET ditandai_diterima_at = @t, updated_at = @t WHERE order_id = @orderId`)
    .run({ orderId, t: now() });
}

function ambilOrder(orderId) {
  return db.prepare(`SELECT * FROM orders_meta WHERE order_id = ?`).get(orderId);
}

function ambilOrderUser(userWallet) {
  return db.prepare(`SELECT * FROM orders_meta WHERE user_wallet = ? ORDER BY created_at DESC`).all(userWallet);
}

/** Order non-COD yang sukses lebih dari 7 hari lalu & belum ditandai diterima — buat auto-mark (display only, tidak sentuh dana). */
function ambilOrderPerluAutoDiterima() {
  const batas = now() - 7 * 24 * 3600;
  return db.prepare(`
    SELECT * FROM orders_meta
    WHERE onchain_status = 'SUCCESS' AND is_cod = 0
      AND ditandai_diterima_at IS NULL AND updated_at <= ?
  `).all(batas);
}

// ─────────────────────────────────────────────────────────────────
// KATALOG PRODUK UNGGULAN
// ─────────────────────────────────────────────────────────────────

function tambahKatalog({ linkProduk, platform, kategori }) {
  const t = now();
  db.prepare(`
    INSERT INTO katalog_produk (link_produk, platform, kategori, aktif, created_at, updated_at)
    VALUES (@linkProduk, @platform, @kategori, 1, @t, @t)
    ON CONFLICT(link_produk) DO UPDATE SET aktif = 1, updated_at = @t
  `).run({ linkProduk, platform, kategori: kategori || null, t });
}

function updateDetailKatalog(linkProduk, detail) {
  db.prepare(`
    UPDATE katalog_produk SET
      nama_produk = @namaProduk, deskripsi = @deskripsi, foto_url = @fotoUrl,
      harga_modal = @hargaModal, nama_toko = @namaToko, rating = @rating,
      stok_status = @stokStatus, fetch_gagal_terakhir = 0, updated_at = @t
    WHERE link_produk = @linkProduk
  `).run({
    linkProduk,
    namaProduk: detail.namaProduk,
    deskripsi: detail.deskripsi,
    fotoUrl: JSON.stringify(detail.fotoUrl || []),
    hargaModal: detail.hargaModal,
    namaToko: detail.namaToko,
    rating: detail.rating || null,
    stokStatus: detail.stokStatus || null,
    t: now(),
  });
}

function tandaiKatalogGagalFetch(linkProduk) {
  db.prepare(`UPDATE katalog_produk SET fetch_gagal_terakhir = 1, updated_at = @t WHERE link_produk = @linkProduk`)
    .run({ linkProduk, t: now() });
}

function setFeeManualKatalog(linkProduk, feeManual) {
  db.prepare(`UPDATE katalog_produk SET fee_manual = ?, updated_at = ? WHERE link_produk = ?`)
    .run(feeManual, now(), linkProduk);
}

function hapusKatalog(linkProduk) {
  // Soft-delete — order yang masih aktif buat produk ini tetap jalan normal
  // (tabel orders_meta terpisah, gak kesentuh sama sekali oleh ini).
  db.prepare(`UPDATE katalog_produk SET aktif = 0, updated_at = ? WHERE link_produk = ?`).run(now(), linkProduk);
}

function ambilKatalogByLink(linkProduk) {
  return db.prepare(`SELECT * FROM katalog_produk WHERE link_produk = ? AND aktif = 1`).get(linkProduk);
}

function ambilKatalogAktif(kategori) {
  if (kategori) {
    return db.prepare(`SELECT * FROM katalog_produk WHERE aktif = 1 AND kategori = ? ORDER BY updated_at DESC`).all(kategori);
  }
  return db.prepare(`SELECT * FROM katalog_produk WHERE aktif = 1 ORDER BY updated_at DESC`).all();
}

function ambilSemuaKatalogPerluRefresh(maxUsiaDetik) {
  const batas = now() - maxUsiaDetik;
  return db.prepare(`SELECT * FROM katalog_produk WHERE aktif = 1 AND updated_at <= ?`).all(batas);
}

// ─────────────────────────────────────────────────────────────────
// FETCH CACHE
// ─────────────────────────────────────────────────────────────────

function ambilCache(linkProduk, maxUsiaDetik) {
  const row = db.prepare(`SELECT * FROM fetch_cache WHERE link_produk = ?`).get(linkProduk);
  if (!row) return null;
  if (now() - row.fetched_at > maxUsiaDetik) return null;
  return JSON.parse(row.data_json);
}

function simpanCache(linkProduk, data) {
  db.prepare(`
    INSERT INTO fetch_cache (link_produk, data_json, fetched_at)
    VALUES (?, ?, ?)
    ON CONFLICT(link_produk) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at
  `).run(linkProduk, JSON.stringify(data), now());
}

// ─────────────────────────────────────────────────────────────────
// ALERT LOG (eskalasi jam 6 & 12 di PROCESSING)
// ─────────────────────────────────────────────────────────────────

function sudahDikirimAlert(orderId, tingkat) {
  return !!db.prepare(`SELECT 1 FROM alert_log WHERE order_id = ? AND tingkat = ?`).get(orderId, tingkat);
}

function catatAlertTerkirim(orderId, tingkat) {
  db.prepare(`INSERT OR IGNORE INTO alert_log (order_id, tingkat, sent_at) VALUES (?, ?, ?)`)
    .run(orderId, tingkat, now());
}

module.exports = {
  db,
  simpanOrderBaru,
  updateStatusOrder,
  tandaiAutoDiterima,
  ambilOrder,
  ambilOrderUser,
  ambilOrderPerluAutoDiterima,
  tambahKatalog,
  updateDetailKatalog,
  tandaiKatalogGagalFetch,
  setFeeManualKatalog,
  hapusKatalog,
  ambilKatalogByLink,
  ambilKatalogAktif,
  ambilSemuaKatalogPerluRefresh,
  ambilCache,
  simpanCache,
  sudahDikirimAlert,
  catatAlertTerkirim,
};
