/**
 * sync-catalog.js
 * Tarik katalog produk dari Digiflazz (price-list API) dan simpan ke
 * database lokal (tabel `products`) — dipakai server.js untuk hitung
 * quote harga tanpa perlu panggil API Digiflazz tiap checkout.
 *
 * CARA PAKAI:
 *   node sync-catalog.js
 *
 * Jalankan berkala (misal via cron, 1-2x sehari) — BUKAN tiap menit,
 * sesuai anjuran resmi Digiflazz untuk tidak memanggil price-list
 * berulang-ulang.
 *
 * Catatan: harga_jual_manual (kolom override Dev) TIDAK PERNAH disentuh
 * script ini — cuma harga_modal, nama, dan status seller yang diperbarui
 * tiap sync, supaya harga yang sudah diatur Dev tidak pernah tertimpa.
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const db = require('./db');

const USERNAME = process.env.DIGIFLAZZ_USERNAME;
const API_KEY = process.env.DIGIFLAZZ_APIKEY;

function sign() {
  return crypto.createHash('md5').update(USERNAME + API_KEY + 'pricelist').digest('hex');
}

async function ambilDaftarHarga(cmd) {
  const res = await axios.post('https://api.digiflazz.com/v1/price-list', {
    cmd,
    username: USERNAME,
    sign: sign(),
  });
  return res.data.data || [];
}

async function syncCatalog() {
  console.log('[sync-catalog] Mengambil daftar harga prabayar dari Digiflazz...');
  const prepaid = await ambilDaftarHarga('prepaid');

  console.log('[sync-catalog] Mengambil daftar harga pascabayar dari Digiflazz...');
  const pasca = await ambilDaftarHarga('pasca');

  const produk = [...prepaid, ...pasca];
  if (produk.length === 0) {
    console.log('[sync-catalog] Tidak ada produk ditemukan.');
    return;
  }

  let count = 0;
  let countPascabayar = 0;
  for (const p of produk) {
    if (!p.buyer_product_status) continue; // skip yang belum di-ON-kan

    const isPascabayar = (p.category || '').toLowerCase() === 'pascabayar';
    const sellerStatus = p.seller_product_status ? 'valid' : 'invalid';

    // Produk pascabayar TIDAK punya field "price" dari Digiflazz (mereka
    // pakai "admin" + "commission" sebagai gantinya, karena tagihan
    // aslinya baru diketahui saat cek tagihan per transaksi). Pakai fee
    // admin sebagai nilai simpanan sementara di katalog — bukan harga
    // final, cuma supaya kolom database tidak kosong.
    const hargaModal = p.price != null ? p.price : (p.admin || 0);

    db.upsertProduct(p.buyer_sku_code, p.product_name, p.brand, hargaModal, isPascabayar, sellerStatus);
    count++;
    if (isPascabayar) countPascabayar++;
  }

  console.log(`[sync-catalog] Selesai — ${count} produk aktif tersimpan ke database lokal (${countPascabayar} di antaranya pascabayar).`);
}

syncCatalog().catch((err) => {
  console.error('[sync-catalog] Gagal sync:', err.message);
  process.exit(1);
});
