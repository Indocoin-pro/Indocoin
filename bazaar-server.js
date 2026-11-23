/**
 * bazaar-server.js
 * Layanan penyimpanan untuk Bazaar INDOCOIN (fase 1, tanpa transaksi).
 *
 * Tugasnya cuma yang tidak bisa di blockchain: menyimpan foto, spesifikasi
 * produk, profil toko, serta dokumen NIB dan rekening yang dienkripsi.
 * Kontrak BazaarRegistry hanya menyimpan hash (sha256, 32 byte) dari isi
 * semua berkas ini. Siapa pun bisa mengecek: sha256(berkas) harus sama
 * dengan hash di kontrak.
 *
 * Penjaga sebenarnya ada di sini, bukan di tampilan:
 * - Setiap penulisan wajib bertanda tangan wallet (EIP-191), terikat pada
 *   aksi, isi berkas (hash body), dan waktu (maks 5 menit, tidak bisa dipakai ulang).
 *   Agar penjual tidak diminta tanda tangan untuk tiap foto: satu tanda tangan
 *   (aksi "sesi") menghasilkan token 1 jam untuk unggahan. Akses admin (dokumen
 *   dan rekening) selalu butuh tanda tangan baru, tidak pernah lewat sesi.
 * - Foto produk dan spesifikasi hanya untuk penjual berstatus Disetujui
 *   (dicek on-chain lewat isSellerActive).
 * - Dokumen NIB dan rekening hanya bisa dibuka wallet owner kontrak.
 *
 * Hanya butuh paket `ethers` (v5 atau v6, keduanya didukung). Tanpa express.
 *
 * ENV:
 *   BAZAAR_PORT      default 3010
 *   BAZAAR_DATA      folder data, default ./bazaar-data (di luar folder git!)
 *   BAZAAR_RPC       default https://bsc-dataseed.binance.org
 *   BAZAAR_REGISTRY  default alamat BazaarRegistry mainnet
 *   BAZAAR_DOC_KEY   WAJIB, 64 karakter hex (32 byte), kunci enkripsi dokumen
 *                    dan rekening. Buat: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *                    SIMPAN CADANGANNYA. Kunci hilang = dokumen tidak bisa dibuka lagi.
 *   BAZAAR_ORIGINS   daftar origin yang diizinkan, pisah koma
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────────────────────────────

const CFG = {
  port: Number(process.env.BAZAAR_PORT || 3010),
  dataDir: process.env.BAZAAR_DATA || path.join(__dirname, 'bazaar-data'),
  rpc: process.env.BAZAAR_RPC || 'https://bsc-dataseed.binance.org',
  registry: process.env.BAZAAR_REGISTRY || '0x4DD2aE0bfa276E82F32066587bD3E9bdC6891C7b',
  docKeyHex: process.env.BAZAAR_DOC_KEY || '',
  origins: (process.env.BAZAAR_ORIGINS || 'https://indocoin.id,https://www.indocoin.id')
    .split(',').map(s => s.trim()).filter(Boolean),
};

const LIMIT = {
  fotoBytes: 5 * 1024 * 1024,
  fotoMinPx: 600,
  fotoMaxPx: 4096,
  jsonBytes: 64 * 1024,
  dokumenBodyBytes: 12 * 1024 * 1024,
  dokumenFileBytes: 8 * 1024 * 1024,
  sigMaxAgeMs: 5 * 60 * 1000,
  sesiMs: 60 * 60 * 1000, // sekali tanda tangan, berlaku 1 jam untuk unggahan
};

// Batas penulisan per wallet per 24 jam, dan per IP per jam.
const RATE_WALLET_DAY = { sesi: 30, 'foto-produk': 60, 'foto-toko': 10, spek: 60, profil: 10, dokumen: 5, rekening: 10 };
const RATE_IP_HOUR = 200;

const BENTUK_USAHA = [
  'Usaha perorangan', 'Usaha Mikro/Kecil', 'PT Perorangan', 'CV', 'PT',
  'Firma', 'Koperasi', 'BUMDes', 'Kelompok usaha',
];

// ─────────────────────────────────────────────────────────────────
// UTIL
// ─────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const isAddr = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);

/** Bersihkan teks: buang karakter kontrol, rapikan spasi. */
function bersih(v, min, max, nama, opsional) {
  if (v === undefined || v === null || v === '') {
    if (opsional) return '';
    throw new HttpError(400, `${nama} wajib diisi`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `${nama} harus berupa teks`);
  const t = v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < min && !(opsional && t.length === 0)) throw new HttpError(400, `${nama} minimal ${min} karakter`);
  if (t.length > max) throw new HttpError(400, `${nama} maksimal ${max} karakter`);
  return t;
}

// ─────────────────────────────────────────────────────────────────
// PEMERIKSA GAMBAR (tanpa library; hanya JPEG dan PNG)
// Mengembalikan ukuran asli dan salinan tanpa metadata (EXIF/GPS dibuang,
// supaya lokasi rumah penjual tidak ikut terunggah).
// ─────────────────────────────────────────────────────────────────

function periksaJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw new HttpError(400, 'Berkas bukan JPEG yang valid');
  const out = [buf.subarray(0, 2)];
  let i = 2, w = 0, h = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) throw new HttpError(400, 'JPEG rusak');
    while (buf[i] === 0xFF) i++;
    const m = buf[i++];
    if (m === 0xD9) break;
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { out.push(Buffer.from([0xFF, m])); continue; }
    if (i + 2 > buf.length) throw new HttpError(400, 'JPEG rusak');
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) throw new HttpError(400, 'JPEG rusak');
    const seg = buf.subarray(i - 2, i + len); // termasuk 0xFF + marker
    const isSof = m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
    if (isSof) {
      if (len < 8) throw new HttpError(400, 'JPEG rusak');
      h = buf.readUInt16BE(i + 3);
      w = buf.readUInt16BE(i + 5);
    }
    const buang = (m >= 0xE1 && m <= 0xEF) || m === 0xFE; // APP1..APP15 (EXIF, XMP, ICC dll) dan komentar
    if (!buang) out.push(seg);
    i += len;
    if (m === 0xDA) { // mulai data gambar: salin sisanya apa adanya
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }
  }
  if (!w || !h) throw new HttpError(400, 'Ukuran JPEG tidak terbaca');
  return { tipe: 'jpg', width: w, height: h, bersih: Buffer.concat(out) };
}

function periksaPng(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new HttpError(400, 'Berkas bukan PNG yang valid');
  const out = [SIG];
  const DIBUANG = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  let i = 8, w = 0, h = 0, adaIend = false;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const tipe = buf.toString('latin1', i + 4, i + 8);
    const akhir = i + 12 + len;
    if (akhir > buf.length) throw new HttpError(400, 'PNG rusak');
    if (tipe === 'IHDR') {
      if (len !== 13) throw new HttpError(400, 'PNG rusak');
      w = buf.readUInt32BE(i + 8);
      h = buf.readUInt32BE(i + 12);
    }
    if (!DIBUANG.has(tipe)) out.push(buf.subarray(i, akhir));
    i = akhir;
    if (tipe === 'IEND') { adaIend = true; break; }
  }
  if (!w || !h || !adaIend) throw new HttpError(400, 'PNG rusak');
  return { tipe: 'png', width: w, height: h, bersih: Buffer.concat(out) };
}

function periksaFoto(buf) {
  if (!buf || buf.length === 0) throw new HttpError(400, 'Foto kosong');
  if (buf.length > LIMIT.fotoBytes) throw new HttpError(413, 'Foto terlalu besar (maksimal 5 MB)');
  let info;
  if (buf[0] === 0xFF && buf[1] === 0xD8) info = periksaJpeg(buf);
  else if (buf[0] === 0x89 && buf[1] === 0x50) info = periksaPng(buf);
  else throw new HttpError(400, 'Format foto harus JPG atau PNG');
  if (info.width !== info.height) {
    throw new HttpError(400, `Foto harus persegi 1:1 (foto kamu ${info.width}x${info.height})`);
  }
  if (info.width < LIMIT.fotoMinPx) throw new HttpError(400, `Foto terlalu kecil, minimal ${LIMIT.fotoMinPx}x${LIMIT.fotoMinPx} piksel`);
  if (info.width > LIMIT.fotoMaxPx) throw new HttpError(400, `Foto terlalu besar, maksimal ${LIMIT.fotoMaxPx}x${LIMIT.fotoMaxPx} piksel`);
  return info;
}

// ─────────────────────────────────────────────────────────────────
// ENKRIPSI (AES-256-GCM) untuk dokumen NIB dan rekening
// ─────────────────────────────────────────────────────────────────

function kunciDokumen() {
  if (!/^[0-9a-fA-F]{64}$/.test(CFG.docKeyHex)) {
    throw new HttpError(500, 'Server belum dikonfigurasi (BAZAAR_DOC_KEY)');
  }
  return Buffer.from(CFG.docKeyHex, 'hex');
}

function enkripsi(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kunciDokumen(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function dekripsi(amplop) {
  const d = crypto.createDecipheriv('aes-256-gcm', kunciDokumen(), Buffer.from(amplop.iv, 'base64'));
  d.setAuthTag(Buffer.from(amplop.tag, 'base64'));
  const plain = Buffer.concat([d.update(Buffer.from(amplop.data, 'base64')), d.final()]);
  return JSON.parse(plain.toString('utf8'));
}

// ─────────────────────────────────────────────────────────────────
// PENYIMPANAN (berkas di disk, nama = hash isinya)
// ─────────────────────────────────────────────────────────────────

function siapkanFolder() {
  for (const d of ['foto', 'spek', 'profil', 'dokumen', 'rekening']) {
    fs.mkdirSync(path.join(CFG.dataDir, d), { recursive: true });
  }
}

function tulisAtomik(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const pathBerkas = (jenis, nama) => path.join(CFG.dataDir, jenis, nama);
const adaBerkas = (jenis, nama) => fs.existsSync(pathBerkas(jenis, nama));

function cariFoto(hash) {
  for (const ext of ['jpg', 'png']) {
    if (adaBerkas('foto', `${hash}.${ext}`)) return { file: pathBerkas('foto', `${hash}.${ext}`), ext };
  }
  return null;
}

// Indeks pencegah spam: satu berkas dokumen dan satu NIB hanya untuk satu wallet.
let indeksDok = { byFile: {}, byNib: {} };
function muatIndeks() {
  try { indeksDok = JSON.parse(fs.readFileSync(pathBerkas('dokumen', 'indeks.json'), 'utf8')); }
  catch { indeksDok = { byFile: {}, byNib: {} }; }
}
function simpanIndeks() { tulisAtomik(pathBerkas('dokumen', 'indeks.json'), JSON.stringify(indeksDok)); }

// ─────────────────────────────────────────────────────────────────
// TANDA TANGAN WALLET + BATAS PEMAKAIAN
// ─────────────────────────────────────────────────────────────────

const sigDipakai = new Map(); // sig -> kedaluwarsa
const jejakWallet = new Map(); // "aksi:wallet" -> [timestamp]
const jejakIp = new Map(); // ip -> [timestamp]
const sesiAktif = new Map(); // token -> { wallet, exp }

function bersihkanMemori() {
  const now = Date.now();
  for (const [k, exp] of sigDipakai) if (exp < now) sigDipakai.delete(k);
  for (const [k, v] of sesiAktif) if (v.exp < now) sesiAktif.delete(k);
  for (const [k, arr] of jejakWallet) { const a = arr.filter(t => now - t < 86400000); a.length ? jejakWallet.set(k, a) : jejakWallet.delete(k); }
  for (const [k, arr] of jejakIp) { const a = arr.filter(t => now - t < 3600000); a.length ? jejakIp.set(k, a) : jejakIp.delete(k); }
}

/** Pesan yang harus ditandatangani wallet. Frontend wajib membuat teks yang persis sama. */
function buatPesan(aksi, wallet, ts, bodyHash) {
  return `Bazaar INDOCOIN\naksi:${aksi}\nwallet:${wallet.toLowerCase()}\ntimestamp:${ts}\nbody:${bodyHash}`;
}

function catatPakai(kunci, peta, jendelaMs, batas, pesan) {
  const now = Date.now();
  const arr = (peta.get(kunci) || []).filter(t => now - t < jendelaMs);
  if (arr.length >= batas) throw new HttpError(429, pesan);
  arr.push(now);
  peta.set(kunci, arr);
}

// ─────────────────────────────────────────────────────────────────
// APLIKASI
// ─────────────────────────────────────────────────────────────────

function ambilDepsBawaan() {
  const E = require('ethers');
  const verifyMessage = E.verifyMessage || (E.utils && E.utils.verifyMessage);
  const provider = E.JsonRpcProvider
    ? new E.JsonRpcProvider(CFG.rpc, 56)
    : new E.providers.JsonRpcProvider(CFG.rpc, 56);
  const abi = ['function owner() view returns (address)', 'function isSellerActive(address) view returns (bool)'];
  const kontrak = new E.Contract(CFG.registry, abi, provider);
  let owner = { alamat: '', exp: 0 };
  return {
    verifyMessage,
    isSellerActive: (w) => kontrak.isSellerActive(w),
    getOwner: async () => {
      if (Date.now() > owner.exp) owner = { alamat: String(await kontrak.owner()).toLowerCase(), exp: Date.now() + 5 * 60 * 1000 };
      return owner.alamat;
    },
  };
}

function createApp(deps) {
  deps = deps || ambilDepsBawaan();

  async function verifikasi(req, aksi, body) {
    const wallet = String(req.headers['x-wallet'] || '');
    const ts = String(req.headers['x-ts'] || '');
    const sig = String(req.headers['x-sig'] || '');
    const token = String(req.headers['x-token'] || '');
    // Sesi: dipakai agar penjual tidak perlu tanda tangan untuk setiap foto. Tidak berlaku untuk akses admin.
    if (token && isAddr(wallet) && !aksi.startsWith('admin-') && aksi !== 'sesi') {
      const s = sesiAktif.get(token);
      if (!s || s.exp < Date.now()) throw new HttpError(401, 'Sesi berakhir, tanda tangan ulang');
      if (s.wallet !== wallet.toLowerCase()) throw new HttpError(401, 'Sesi bukan milik wallet ini');
      return s.wallet;
    }
    if (!isAddr(wallet) || !/^\d{10,16}$/.test(ts) || !sig) throw new HttpError(401, 'Tanda tangan wallet tidak lengkap');
    if (Math.abs(Date.now() - Number(ts)) > LIMIT.sigMaxAgeMs) throw new HttpError(401, 'Tanda tangan kedaluwarsa, coba lagi');
    if (sigDipakai.has(sig)) throw new HttpError(401, 'Tanda tangan sudah dipakai');
    let pulih;
    try { pulih = deps.verifyMessage(buatPesan(aksi, wallet, ts, sha256Hex(body)), sig); }
    catch { throw new HttpError(401, 'Tanda tangan tidak valid'); }
    if (String(pulih).toLowerCase() !== wallet.toLowerCase()) throw new HttpError(401, 'Tanda tangan tidak cocok dengan wallet');
    sigDipakai.set(sig, Date.now() + LIMIT.sigMaxAgeMs * 2);
    return wallet.toLowerCase();
  }

  function batasi(req, aksi, wallet) {
    const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'x');
    catatPakai(ip, jejakIp, 3600000, RATE_IP_HOUR, 'Terlalu banyak permintaan, coba lagi nanti');
    catatPakai(`${aksi}:${wallet}`, jejakWallet, 86400000, RATE_WALLET_DAY[aksi], 'Batas unggah harian untuk jenis ini sudah tercapai');
  }

  async function wajibPenjualAktif(wallet) {
    let aktif = false;
    try { aktif = await deps.isSellerActive(wallet); }
    catch { throw new HttpError(503, 'Gagal memeriksa status penjual di blockchain, coba lagi'); }
    if (!aktif) throw new HttpError(403, 'Hanya penjual yang sudah disetujui admin yang boleh melakukan ini');
  }

  async function wajibOwner(wallet) {
    let owner;
    try { owner = await deps.getOwner(); }
    catch { throw new HttpError(503, 'Gagal membaca owner kontrak, coba lagi'); }
    if (wallet !== owner) throw new HttpError(403, 'Hanya wallet Dev');
  }

  function bacaBody(req, batas) {
    return new Promise((resolve, reject) => {
      const bagian = []; let total = 0;
      req.on('data', (c) => {
        total += c.length;
        if (total > batas) { reject(new HttpError(413, 'Berkas terlalu besar')); req.destroy(); return; }
        bagian.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(bagian)));
      req.on('error', () => reject(new HttpError(400, 'Gagal membaca permintaan')));
    });
  }

  function bacaJson(body) {
    try {
      const o = JSON.parse(body.toString('utf8'));
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error();
      return o;
    } catch { throw new HttpError(400, 'Isi permintaan bukan JSON yang valid'); }
  }

  // ── Handler tulis ──────────────────────────────────────────────

  async function fotoUnggah(req, kind) {
    if (kind !== 'produk' && kind !== 'toko') throw new HttpError(400, 'Jenis foto harus produk atau toko');
    const aksi = `foto-${kind}`;
    const body = await bacaBody(req, LIMIT.fotoBytes + 1024);
    const wallet = await verifikasi(req, aksi, body);
    if (kind === 'produk') await wajibPenjualAktif(wallet);
    batasi(req, aksi, wallet);
    const info = periksaFoto(body);
    const hash = sha256Hex(info.bersih);
    const file = pathBerkas('foto', `${hash}.${info.tipe}`);
    if (!fs.existsSync(file)) tulisAtomik(file, info.bersih);
    return { hash: '0x' + hash, url: `/bazaar/foto/${hash}`, ukuran: info.width };
  }

  async function sesiBuat(req) {
    const body = await bacaBody(req, 1024);
    const wallet = await verifikasi(req, 'sesi', body);
    batasi(req, 'sesi', wallet);
    const token = crypto.randomBytes(24).toString('hex');
    const exp = Date.now() + LIMIT.sesiMs;
    sesiAktif.set(token, { wallet, exp });
    return { token, exp };
  }

  async function profilSimpan(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'profil', body);
    batasi(req, 'profil', wallet);
    const j = bacaJson(body);
    const bentuk = String(j.bentukUsaha || '');
    if (!BENTUK_USAHA.includes(bentuk)) throw new HttpError(400, 'Bentuk usaha tidak dikenal');
    const foto = String(j.fotoToko || '').replace(/^0x/, '');
    if (!isHex64(foto) || !cariFoto(foto)) throw new HttpError(400, 'Foto toko belum diunggah');
    const doc = {
      versi: 1,
      penjual: wallet,
      namaToko: bersih(j.namaToko, 3, 60, 'Nama toko'),
      kota: bersih(j.kota, 2, 60, 'Kota'),
      bentukUsaha: bentuk,
      merek: bersih(j.merek, 0, 80, 'Merek', true),
      deskripsi: bersih(j.deskripsi, 0, 500, 'Deskripsi', true),
      fotoToko: foto,
    };
    return simpanDokumenPublik('profil', doc);
  }

  function simpanDokumenPublik(jenis, doc) {
    const teks = JSON.stringify(doc);
    const hash = sha256Hex(teks);
    const file = pathBerkas(jenis, `${hash}.json`);
    if (!fs.existsSync(file)) tulisAtomik(file, teks);
    return { hash: '0x' + hash, url: `/bazaar/${jenis}/${hash}` };
  }

  async function spekSimpan(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'spek', body);
    await wajibPenjualAktif(wallet);
    batasi(req, 'spek', wallet);
    const j = bacaJson(body);
    const kondisi = String(j.kondisi || '');
    if (kondisi !== 'baru' && kondisi !== 'bekas') throw new HttpError(400, 'Kondisi harus baru atau bekas');
    const berat = Number(j.beratGram);
    if (!Number.isInteger(berat) || berat < 1 || berat > 100000) throw new HttpError(400, 'Berat kirim (gram) tidak valid');
    const kategoriId = Number(j.kategoriId);
    if (!Number.isInteger(kategoriId) || kategoriId < 1 || kategoriId > 64) throw new HttpError(400, 'Kategori tidak valid');
    if (!Array.isArray(j.fotos) || j.fotos.length < 3 || j.fotos.length > 8) throw new HttpError(400, 'Foto produk minimal 3 dan maksimal 8');
    const fotos = j.fotos.map((f) => String(f).replace(/^0x/, ''));
    if (new Set(fotos).size !== fotos.length) throw new HttpError(400, 'Ada foto yang sama dipakai dua kali');
    for (const f of fotos) if (!isHex64(f) || !cariFoto(f)) throw new HttpError(400, 'Ada foto yang belum diunggah');
    const doc = {
      versi: 1,
      penjual: wallet,
      kategoriId,
      nama: bersih(j.nama, 3, 80, 'Nama produk'),
      kondisi,
      deskripsi: bersih(j.deskripsi, 0, 1000, 'Deskripsi', true),
      bahan: bersih(j.bahan, 1, 200, 'Bahan'),
      ukuran: bersih(j.ukuran, 1, 200, 'Ukuran'),
      warna: bersih(j.warna, 1, 200, 'Warna'),
      isiPaket: bersih(j.isiPaket, 1, 300, 'Isi paket'),
      beratGram: berat,
      garansi: bersih(j.garansi, 0, 200, 'Garansi', true),
      fotos,
    };
    return simpanDokumenPublik('spek', doc);
  }

  async function dokumenSimpan(req) {
    const body = await bacaBody(req, LIMIT.dokumenBodyBytes);
    const wallet = await verifikasi(req, 'dokumen', body);
    batasi(req, 'dokumen', wallet);
    const j = bacaJson(body);
    const nib = bersih(j.nib, 5, 40, 'Nomor NIB atau legalitas');
    if (!/^[0-9A-Za-z./ -]+$/.test(nib)) throw new HttpError(400, 'Nomor legalitas hanya boleh huruf, angka, titik, garis miring dan strip');
    const nibNorm = nib.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const nomorMerek = bersih(j.nomorMerek, 0, 80, 'Nomor merek', true);
    if (typeof j.fileBase64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(j.fileBase64)) throw new HttpError(400, 'Berkas dokumen tidak valid');
    const file = Buffer.from(j.fileBase64, 'base64');
    if (file.length === 0 || file.length > LIMIT.dokumenFileBytes) throw new HttpError(413, 'Dokumen kosong atau lebih dari 8 MB');
    let mime;
    if (file.subarray(0, 4).toString('latin1') === '%PDF') mime = 'application/pdf';
    else if (file[0] === 0xFF && file[1] === 0xD8 && file[2] === 0xFF) mime = 'image/jpeg';
    else if (file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4E && file[3] === 0x47) mime = 'image/png';
    else throw new HttpError(400, 'Dokumen harus PDF, JPG, atau PNG');

    const fileSha = sha256Hex(file);
    const nibKey = sha256Hex(nibNorm);
    const pemilikFile = indeksDok.byFile[fileSha];
    const pemilikNib = indeksDok.byNib[nibKey];
    if ((pemilikFile && pemilikFile !== wallet) || (pemilikNib && pemilikNib !== wallet)) {
      throw new HttpError(409, 'Dokumen atau nomor ini sudah terdaftar pada toko lain. Hubungi admin jika ini kesalahan.');
    }
    const hash = sha256Hex(`${nibNorm}:${fileSha}`);
    const tujuan = pathBerkas('dokumen', `${hash}.json`);
    if (!fs.existsSync(tujuan)) {
      tulisAtomik(tujuan, JSON.stringify(enkripsi({ wallet, nib, nomorMerek, mime, fileBase64: j.fileBase64, ts: Date.now() })));
    }
    indeksDok.byFile[fileSha] = wallet;
    indeksDok.byNib[nibKey] = wallet;
    simpanIndeks();
    return { hash: '0x' + hash };
  }

  async function rekeningSimpan(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'rekening', body);
    batasi(req, 'rekening', wallet);
    const j = bacaJson(body);
    const noRek = String(j.noRek || '').replace(/[\s-]/g, '');
    if (!/^\d{5,25}$/.test(noRek)) throw new HttpError(400, 'Nomor rekening harus 5 sampai 25 angka');
    // Salt acak supaya hash di blockchain tidak bisa ditebak dengan mencoba nomor rekening satu per satu.
    const bundel = {
      wallet,
      bank: bersih(j.bank, 2, 40, 'Nama bank'),
      noRek,
      atasNama: bersih(j.atasNama, 3, 80, 'Nama pemilik rekening'),
      salt: crypto.randomBytes(16).toString('hex'),
    };
    const hash = sha256Hex(JSON.stringify(bundel));
    tulisAtomik(pathBerkas('rekening', `${hash}.json`), JSON.stringify(enkripsi(bundel)));
    return { hash: '0x' + hash };
  }

  async function adminBaca(req, jenis, hash) {
    if (jenis !== 'dokumen' && jenis !== 'rekening') throw new HttpError(404, 'Tidak ditemukan');
    if (!isHex64(hash)) throw new HttpError(400, 'Hash tidak valid');
    const wallet = await verifikasi(req, `admin-${jenis}`, Buffer.alloc(0));
    await wajibOwner(wallet);
    if (!adaBerkas(jenis, `${hash}.json`)) throw new HttpError(404, 'Berkas tidak ditemukan');
    return dekripsi(JSON.parse(fs.readFileSync(pathBerkas(jenis, `${hash}.json`), 'utf8')));
  }

  // ── Router ─────────────────────────────────────────────────────

  function kirimJson(res, status, obj, extra) {
    const teks = JSON.stringify(obj);
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra));
    res.end(teks);
  }

  function setCors(req, res) {
    const o = req.headers.origin;
    if (o && CFG.origins.includes(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wallet, x-ts, x-sig, x-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  async function tangani(req, res) {
    const url = new URL(req.url, 'http://x');
    const bagian = url.pathname.split('/').filter(Boolean); // ['bazaar', ...]
    if (bagian[0] !== 'bazaar') throw new HttpError(404, 'Tidak ditemukan');
    const [, a, b, c] = bagian;

    if (req.method === 'GET' && a === 'health') return kirimJson(res, 200, { ok: true });

    // Baca publik
    if (req.method === 'GET' && (a === 'foto' || a === 'spek' || a === 'profil') && b && !c) {
      if (!isHex64(b)) throw new HttpError(400, 'Hash tidak valid');
      const kebal = { 'Cache-Control': 'public, max-age=31536000, immutable' };
      if (a === 'foto') {
        const f = cariFoto(b);
        if (!f) throw new HttpError(404, 'Tidak ditemukan');
        res.writeHead(200, Object.assign({ 'Content-Type': f.ext === 'jpg' ? 'image/jpeg' : 'image/png' }, kebal));
        return res.end(fs.readFileSync(f.file));
      }
      if (!adaBerkas(a, `${b}.json`)) throw new HttpError(404, 'Tidak ditemukan');
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, kebal));
      return res.end(fs.readFileSync(pathBerkas(a, `${b}.json`)));
    }

    // Tulis
    if (req.method === 'POST') {
      if (a === 'foto' && b) return kirimJson(res, 200, await fotoUnggah(req, b));
      if (a === 'sesi' && !b) return kirimJson(res, 200, await sesiBuat(req));
      if (a === 'profil' && !b) return kirimJson(res, 200, await profilSimpan(req));
      if (a === 'spek' && !b) return kirimJson(res, 200, await spekSimpan(req));
      if (a === 'dokumen' && !b) return kirimJson(res, 200, await dokumenSimpan(req));
      if (a === 'rekening' && !b) return kirimJson(res, 200, await rekeningSimpan(req));
    }

    // Khusus wallet Dev
    if (req.method === 'GET' && a === 'admin' && b && c) return kirimJson(res, 200, await adminBaca(req, b, c));

    // Pembeli melihat rekening penjual: baru dibuka saat tahap transaksi (escrow) aktif.
    if (req.method === 'GET' && a === 'rekening') {
      throw new HttpError(501, 'Belum aktif. Rekening hanya dibuka untuk pembeli setelah jaminan penjual terkunci (tahap transaksi).');
    }
    throw new HttpError(404, 'Tidak ditemukan');
  }

  return http.createServer(async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try { await tangani(req, res); }
    catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[bazaar]', e);
      if (!res.headersSent) kirimJson(res, status, { error: status === 500 ? 'Kesalahan server' : e.message });
      else res.end();
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────

function start() {
  kunciDokumen(); // gagal cepat kalau kunci belum diisi
  siapkanFolder();
  muatIndeks();
  setInterval(bersihkanMemori, 10 * 60 * 1000).unref();
  const server = createApp();
  server.listen(CFG.port, '127.0.0.1', () => {
    console.log(`[bazaar] jalan di 127.0.0.1:${CFG.port}, data di ${CFG.dataDir}`);
  });
  return server;
}

module.exports = { sesiAktif, createApp, CFG, LIMIT, buatPesan, periksaFoto, siapkanFolder, muatIndeks, dekripsi };

if (require.main === module) start();
