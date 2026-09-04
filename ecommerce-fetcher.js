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

const HEADERS_BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
};

/**
 * Ambil angka harga dari berbagai bentuk yang mungkin muncul di JSON-LD
 * (kadang "150000", kadang "150000.00", kadang string ada "Rp").
 */
function _parseHarga(nilai) {
  if (nilai === null || nilai === undefined) return null;
  const angka = Number(String(nilai).replace(/[^\d.]/g, ''));
  return Number.isFinite(angka) && angka > 0 ? Math.round(angka) : null;
}

/**
 * Cari objek Product di dalam JSON-LD (bisa berupa objek tunggal, array,
 * atau dibungkus di dalam @graph — ketiga bentuk ini umum dipakai platform
 * besar termasuk Shopee/Tokopedia untuk SEO/rich-snippet Google).
 */
function _cariProductDiJsonLd(parsed) {
  if (!parsed) return null;
  const kandidat = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
  for (const item of kandidat) {
    if (item && (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product')))) {
      return item;
    }
  }
  return null;
}

/**
 * STRATEGI UTAMA — baca JSON-LD (schema.org Product) dari HTML halaman
 * produk. Ini data yang SENGAJA disediakan platform e-commerce untuk
 * dibaca mesin (Google Shopping, rich snippet pencarian) — jadi lebih
 * stabil dibanding endpoint internal yang tidak terdokumentasi.
 */
async function _strategiUtama(linkPenuh, platform) {
  await _jagaJarakRequest();

  const res = await axios.get(linkPenuh, { headers: HEADERS_BROWSER, timeout: TIMEOUT_MS });
  const html = res.data;

  const blokJsonLd = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let product = null;

  for (const blok of blokJsonLd) {
    try {
      const parsed = JSON.parse(blok[1].trim());
      product = _cariProductDiJsonLd(parsed);
      if (product) break;
    } catch {
      // blok JSON-LD ini rusak/gak valid, lanjut coba blok berikutnya
    }
  }

  if (!product) throw new Error('JSON-LD Product tidak ditemukan di halaman');

  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const hargaModal = _parseHarga(offers?.price ?? offers?.lowPrice ?? product.price);
  if (!hargaModal) throw new Error('Harga tidak ditemukan di JSON-LD');

  const fotoRaw = product.image;
  const fotoUrl = Array.isArray(fotoRaw) ? fotoRaw : (fotoRaw ? [fotoRaw] : []);

  return {
    namaProduk: product.name || null,
    deskripsi: product.description || null,
    fotoUrl,
    hargaModal,
    namaToko: product.brand?.name || offers?.seller?.name || null,
    lokasiToko: null,
    rating: product.aggregateRating?.ratingValue ? Number(product.aggregateRating.ratingValue) : null,
    jumlahTerjual: null,
    stokStatus: offers?.availability ? (String(offers.availability).toLowerCase().includes('outofstock') ? 'habis' : 'tersedia') : null,
  };
}

/**
 * STRATEGI CADANGAN — kalau JSON-LD gak ada/gak lengkap, coba baca
 * Open Graph meta tags (og:title, og:image, og:description). Ini juga
 * data publik standar buat preview link (WhatsApp, Facebook, dll), jadi
 * hampir semua halaman produk punya ini — tapi biasanya TIDAK ada harga
 * di sini, jadi tetap butuh hargaModal ketemu lewat cara lain, atau
 * fallback ke isi manual kalau tetap gak ada.
 */
async function _strategiCadangan(linkPenuh, platform) {
  await _jagaJarakRequest();

  const res = await axios.get(linkPenuh, { headers: HEADERS_BROWSER, timeout: TIMEOUT_MS });
  const html = res.data;

  const ambilMeta = (properti) => {
    const m = html.match(new RegExp(`<meta[^>]*property=["']${properti}["'][^>]*content=["']([^"']*)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${properti}["']`, 'i'));
    return m ? m[1] : null;
  };

  const namaProduk = ambilMeta('og:title');
  const fotoOg = ambilMeta('og:image');
  const deskripsi = ambilMeta('og:description');
  const hargaOg = ambilMeta('product:price:amount') || ambilMeta('og:price:amount');
  const hargaModal = _parseHarga(hargaOg);

  if (!namaProduk || !hargaModal) {
    throw new Error('Data minimum (nama+harga) tidak lengkap dari Open Graph');
  }

  return {
    namaProduk,
    deskripsi,
    fotoUrl: fotoOg ? [fotoOg] : [],
    hargaModal,
    namaToko: null,
    lokasiToko: null,
    rating: null,
    jumlahTerjual: null,
    stokStatus: null,
  };
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
