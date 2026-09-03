/**
 * ecommerce-fetcher.js
 * Ambil detail produk (foto, harga, deskripsi, toko, rating, stok) dari
 * link Shopee/Tokopedia yang di-paste user ATAU ditempel admin ke katalog.
 *
 * PENTING (baca sebelum ubah apa pun di sini):
 * Ini BUKAN API resmi berdokumen dari Shopee/Tokopedia — ini baca data
 * publik dari halaman produk itu sendiri (yang dimuat browser mana pun
 * saat orang buka link-nya). Konsekuensinya:
 *   - Formatnya BISA BERUBAH sewaktu-waktu tanpa pemberitahuan.
 *   - Kalau diakses terlalu sering/cepat, bisa kena rate-limit sementara.
 * Makanya di sini WAJIB ada: cache (ecommerce-db.js), rate-limit jarak
 * antar request, dan fallback ke status "gagal, admin cek manual" —
 * JANGAN pernah lempar error ke user sebagai kegagalan sistem.
 */

const axios = require('axios');
require('dotenv').config();

const db = require('./ecommerce-db');

const CACHE_MAX_AGE_DETIK = 6 * 3600; // refresh tiap 6 jam
const MIN_JARAK_REQUEST_MS = 1500;    // jaga jarak antar request keluar
const TIMEOUT_MS = 10000;

let waktuRequestTerakhir = 0;

async function _jagaJarakRequest() {
  const now = Date.now();
  const selisih = now - waktuRequestTerakhir;
  if (selisih < MIN_JARAK_REQUEST_MS) {
    await new Promise((r) => setTimeout(r, MIN_JARAK_REQUEST_MS - selisih));
  }
  waktuRequestTerakhir = Date.now();
}

function deteksiPlatform(link) {
  if (/shopee\.co\.id|shp\.ee/i.test(link)) return 'shopee';
  if (/tokopedia\.com|tokopedia\.link/i.test(link)) return 'tokopedia';
  return null;
}

/**
 * Resolusi link pendek (mis. shp.ee/xxx) jadi URL penuh — Shopee/Tokopedia
 * sering share link dalam bentuk pendek yang perlu di-follow redirect dulu.
 */
async function _resolveLinkPenuh(link) {
  try {
    const res = await axios.get(link, {
      maxRedirects: 5,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
    });
    return res.request?.res?.responseUrl || link;
  } catch {
    return link; // gagal resolve, coba pakai link asli apa adanya
  }
}

// ─────────────────────────────────────────────────────────────────
// STRATEGI FETCH — berlapis, coba satu-satu sampai ada yang berhasil.
// Detail endpoint SENGAJA tidak di-hardcode literal di sini kalau
// berubah-ubah — implementasi konkret tiap strategi ada di bawah,
// tapi kerangka "coba A, gagal coba B, gagal semua -> fallback" ini
// yang penting dijaga strukturnya.
// ─────────────────────────────────────────────────────────────────

async function _strategiUtama(linkPenuh, platform) {
  await _jagaJarakRequest();
  // Implementasi: baca data produk dari halaman/endpoint publik yang
  // sama dipakai halaman produk itu sendiri untuk render (Shopee: PDP
  // data endpoint; Tokopedia: GraphQL publik product detail).
  // Diserahkan ke tim buat isi endpoint spesifik terkini + parsing-nya,
  // supaya gampang di-patch sendiri kalau formatnya berubah tanpa perlu
  // sentuh bagian lain file ini.
  throw new Error('NOT_IMPLEMENTED_STRATEGI_UTAMA');
}

async function _strategiCadangan(linkPenuh, platform) {
  await _jagaJarakRequest();
  // Strategi kedua — dicoba kalau strategi utama gagal (format berubah,
  // di-rate-limit, dll). Boleh pakai pendekatan lebih sederhana (mis.
  // parsing meta-tag Open Graph di HTML halaman: og:title, og:image,
  // og:description) yang lebih jarang berubah dibanding endpoint data
  // internal, walau infonya kurang lengkap (biasanya gak dapat harga).
  throw new Error('NOT_IMPLEMENTED_STRATEGI_CADANGAN');
}

/**
 * @param {string} link  Link produk (boleh link pendek atau penuh)
 * @param {boolean} pakaiCache  Default true — cek cache dulu sebelum fetch baru
 * @returns {{ berhasil: boolean, data: object|null }}
 *   data: { namaProduk, deskripsi, fotoUrl[], hargaModal, namaToko,
 *           lokasiToko, rating, jumlahTerjual, stokStatus, platform }
 */
async function fetchDetailProduk(link, pakaiCache = true) {
  const platform = deteksiPlatform(link);
  if (!platform) {
    return { berhasil: false, data: null, alasan: 'Link bukan dari Shopee atau Tokopedia' };
  }

  if (pakaiCache) {
    const cached = db.ambilCache(link, CACHE_MAX_AGE_DETIK);
    if (cached) return { berhasil: true, data: cached, dariCache: true };
  }

  const linkPenuh = await _resolveLinkPenuh(link);

  const strategiList = [_strategiUtama, _strategiCadangan];
  for (const strategi of strategiList) {
    try {
      const data = await strategi(linkPenuh, platform);
      if (data) {
        data.platform = platform;
        db.simpanCache(link, data);
        return { berhasil: true, data };
      }
    } catch (err) {
      console.warn(`[ecommerce-fetcher.js] Strategi gagal (${strategi.name}):`, err.message);
      // lanjut coba strategi berikutnya
    }
  }

  // Semua strategi gagal -> fallback. JANGAN lempar error ke pemanggil
  // sebagai kegagalan sistem — kembalikan status "perlu review manual".
  return { berhasil: false, data: null, alasan: 'Tidak bisa ambil data otomatis, menunggu review admin' };
}

/**
 * Dipanggil job berkala (cron) buat refresh katalog unggulan — jalan
 * pelan (satu-satu, jeda antar produk) supaya gak mirip serangan
 * scraping massal.
 */
async function refreshKatalog() {
  const perluRefresh = db.ambilSemuaKatalogPerluRefresh(CACHE_MAX_AGE_DETIK);
  for (const produk of perluRefresh) {
    const hasil = await fetchDetailProduk(produk.link_produk, false);
    if (hasil.berhasil) {
      db.updateDetailKatalog(produk.link_produk, {
        namaProduk: hasil.data.namaProduk,
        deskripsi: hasil.data.deskripsi,
        fotoUrl: hasil.data.fotoUrl,
        hargaModal: hasil.data.hargaModal,
        namaToko: hasil.data.namaToko,
        rating: hasil.data.rating,
        stokStatus: hasil.data.stokStatus,
      });
    } else {
      db.tandaiKatalogGagalFetch(produk.link_produk);
      console.warn(`[ecommerce-fetcher.js] Refresh katalog gagal utk: ${produk.link_produk}`);
    }
    // Jeda antar produk biar gak keliatan kayak scraping massal.
    await new Promise((r) => setTimeout(r, 3000));
  }
}

module.exports = {
  deteksiPlatform,
  fetchDetailProduk,
  refreshKatalog,
};
