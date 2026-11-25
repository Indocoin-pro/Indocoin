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
 *   BAZAAR_ESCROW    alamat kontrak BazaarEscrow (modul pesanan; kosong = pesanan nonaktif)
 *   BAZAAR_REPORTER_KEY  private key wallet reporter (hanya untuk markDelivered; saldo BNB kecil saja)
 *   BITESHIP_KEY     API key Biteship (cek ongkir + pelacakan resi). Hanya di VPS, jangan di GitHub.
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
  escrow: process.env.BAZAAR_ESCROW || '',
  reporterKey: process.env.BAZAAR_REPORTER_KEY || '',
  biteshipKey: process.env.BITESHIP_KEY || '',
  biteshipBase: process.env.BITESHIP_BASE || 'https://api.biteship.com',
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
const RATE_WALLET_DAY = { sesi: 30, 'foto-produk': 60, 'foto-toko': 10, spek: 60, profil: 10, dokumen: 5, rekening: 10, tanya: 20, jawab: 100, wa: 10, alamat: 20, resi: 40, ongkir: 60, ulasan: 30, pesanan: 800, legalitas: 20, tampilan: 20 };
const RATE_IP_HOUR = 200;

const BENTUK_USAHA = [
  'Usaha perorangan', 'Usaha Mikro/Kecil', 'PT Perorangan', 'CV', 'PT',
  'Firma', 'Koperasi', 'BUMDes', 'Kelompok usaha',
];

// Urutan sama dengan enum Status di BazaarEscrow.sol
const ST = { Created: 1, SellerLocked: 2, BuyerLocked: 3, Shipped: 4, Delivered: 5, Completed: 6, Cancelled: 7, Disputed: 8, Resolved: 9 };
const STATUS_REKENING = new Set([2, 3, 4, 5, 8]); // rekening penjual terbuka untuk pembeli
const STATUS_AKTIF = new Set([3, 4, 5, 8]);       // WA penjual untuk pembeli, alamat pembeli untuk penjual
const STATUS_SELESAI = new Set([6, 7, 9]);

// Kode kurir di kontrak (uint8) -> kode Biteship. Penjual mengirim sendiri dan mengisi resi.
const KURIR = { 1: { kode: 'jne', nama: 'JNE' }, 2: { kode: 'jnt', nama: 'J&T' }, 3: { kode: 'sicepat', nama: 'SiCepat' }, 4: { kode: 'anteraja', nama: 'AnterAja' } };

// Status pelacakan yang ditampilkan ke pengguna
const LABEL_LACAK = {
  resi_dibuat: 'Resi dibuat', dijemput: 'Dijemput kurir', perjalanan: 'Dalam perjalanan',
  diantar: 'Sedang diantar', sampai: 'Sampai', bermasalah: 'Bermasalah',
};
const PETA_BITESHIP = {
  confirmed: 'resi_dibuat', scheduled: 'resi_dibuat', allocated: 'resi_dibuat',
  picking_up: 'dijemput', picked: 'perjalanan', dropping_off: 'diantar', delivered: 'sampai',
  on_hold: 'bermasalah', rejected: 'bermasalah', courier_not_found: 'bermasalah',
  returned: 'bermasalah', return_in_transit: 'bermasalah', disposed: 'bermasalah', cancelled: 'bermasalah',
};
const petaStatus = (raw) => PETA_BITESHIP[String(raw || '').toLowerCase()] || 'resi_dibuat';

// Ulasan: bintang 1-5 + kata-kata siap pakai (tanpa teks bebas). Kelompok "kurir" tidak mengurangi penjual.
const TAG_ULASAN = {
  positif: { sesuai_deskripsi: 'Sesuai deskripsi', kualitas_bagus: 'Kualitas bagus', kemasan_rapi: 'Kemasan rapi', cepat_dikirim: 'Cepat dikirim', penjual_ramah: 'Penjual ramah', harga_sepadan: 'Harga sepadan' },
  kurang: { kurang_sesuai: 'Kurang sesuai foto', kualitas_biasa: 'Kualitas biasa saja', kemasan_kurang: 'Kemasan kurang rapi', lambat_dikirim: 'Lambat dikirim', cacat_kecil: 'Ada cacat kecil', kurang_responsif: 'Kurang responsif' },
  kurir: { kurir_cepat: 'Kurir cepat', kurir_lambat: 'Kurir lambat', paket_penyok: 'Paket penyok di jalan' },
};
const SEMUA_TAG = new Set([].concat(...Object.values(TAG_ULASAN).map((g) => Object.keys(g))));

const HARI = 86400000;
const JEDA_PANTAU = 3 * 3600000;   // cek kurir tiap pesanan paling sering 3 jam sekali (hemat biaya)
const JEDA_LIHAT = 30 * 60000;     // saat pembeli membuka halaman, segarkan paling sering 30 menit sekali
const JEDA_EDIT_ULASAN = 30 * HARI;
const SIMPAN_ALAMAT = 30 * HARI;   // alamat dihapus 30 hari setelah pesanan selesai

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

/** Nomor HP Indonesia -> 62xxxxxxxxxx. */
function normalHp(v) {
  let d = String(v || '').replace(/[\s.\-()]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(d)) throw new HttpError(400, 'Nomor WhatsApp hanya boleh angka');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  if (!/^62\d{8,13}$/.test(d)) throw new HttpError(400, 'Nomor WhatsApp tidak valid (contoh 081234567890)');
  return d;
}

/** Tanya jawab publik tidak boleh jadi jalan pintas transaksi di luar escrow. */
function tolakKontak(teks) {
  if (/(?:\d[\s.\-]*){9,}/.test(teks) || /https?:|www\.|wa\.me|t\.me|@|\.(com|id|net|co|me|link)\b|whats\s?app|telegram|\bwa\b|\bline\b|\bdm\b|\brekening\b|transfer langsung/i.test(teks)) {
    throw new HttpError(400, 'Jangan cantumkan nomor, tautan, atau ajakan transaksi di luar Bazaar. Kontak penjual terbuka setelah pesanan dibayar ke escrow.');
  }
  return teks;
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
  for (const d of ['foto', 'spek', 'profil', 'dokumen', 'rekening', 'tanya', 'wa', 'alamat', 'pesanan', 'resi', 'ulasan', 'legalitas', 'tampilan']) {
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
  const abi = ['function owner() view returns (address)', 'function isSellerActive(address) view returns (bool)',
    'function getProduct(uint256) view returns (tuple(address seller,uint64 createdAt,uint64 updatedAt,uint16 category,bool active,bool takenDown,uint128 priceIDR,uint128 stock,uint32 reports,bytes32 metaHash))',
    'function getListing(uint256) view returns (address seller,uint256 priceIDR,bytes32 metaHash,uint256 stock,bool buyable)',
    'function getSeller(address) view returns (tuple(uint8 status,uint64 registeredAt,uint64 reviewedAt,uint32 activeOrders,uint32 completedOrders,uint32 disputesTotal,uint32 disputesLost,bytes32 profileHash,bytes32 docHash,bytes32 bankHash,bytes32 pendingBankHash,uint64 bankChangeAt))'];
  const kontrak = new E.Contract(CFG.registry, abi, provider);
  let escrow = null, escrowTulis = null;
  if (/^0x[0-9a-fA-F]{40}$/.test(CFG.escrow)) {
    const eAbi = ['function getOrder(uint256) view returns (tuple(address buyer,address seller,uint256 productId,uint32 qty,uint8 status,uint16 penaltyBps,uint8 courier,uint64 createdAt,uint64 sellerLockedAt,uint64 paidAt,uint64 shippedAt,uint64 deliveredAt,uint64 disputeAt,uint256 baseIDR,uint256 rate,uint256 baseUsdt,uint256 buyerFee,uint256 sellerFee,uint256 buyerStake,uint256 sellerStake,bytes32 metaHash,bytes32 addrHash,bytes32 resiHash))',
      'function markDelivered(uint256)'];
    escrow = new E.Contract(CFG.escrow, eAbi, provider);
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(CFG.reporterKey)) {
      const w = new E.Wallet(CFG.reporterKey.replace(/^(?!0x)/, '0x'), provider);
      escrowTulis = new E.Contract(CFG.escrow, eAbi, w);
    }
  }
  let owner = { alamat: '', exp: 0 };
  return {
    verifyMessage,
    isSellerActive: (w) => kontrak.isSellerActive(w),
    getProductSeller: async (id) => String((await kontrak.getProduct(id)).seller).toLowerCase(),
    getListing: async (id) => {
      const r = await kontrak.getListing(id);
      return { seller: String(r.seller).toLowerCase(), priceIDR: Number(r.priceIDR), metaHash: String(r.metaHash), buyable: !!r.buyable };
    },
    getSeller: async (w) => {
      const r = await kontrak.getSeller(w);
      return { status: Number(r.status), bankHash: String(r.bankHash), activeOrders: Number(r.activeOrders) };
    },
    getOrder: async (id) => {
      if (!escrow) throw new HttpError(503, 'Modul pesanan belum aktif');
      return escrow.getOrder(id);
    },
    markDelivered: async (id) => {
      if (!escrowTulis) throw new Error('reporter belum dikonfigurasi');
      const tx = await escrowTulis.markDelivered(id);
      return tx.hash;
    },
    biteship: async (method, urlPath, body) => {
      if (!CFG.biteshipKey) throw new HttpError(503, 'Layanan ongkir dan pelacakan belum aktif');
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetch(CFG.biteshipBase + urlPath, {
          method,
          headers: { authorization: CFG.biteshipKey, 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctl.signal,
        });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, json: j };
      } finally { clearTimeout(t); }
    },
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

  // Daftar wallet penjual dari berkas dokumen (khusus wallet Dev). Dipakai panel Admin
  // supaya tidak perlu memindai riwayat blockchain lewat RPC publik.
  async function adminDaftarPenjual(req) {
    const wallet = await verifikasi(req, 'admin-daftar', Buffer.alloc(0));
    await wajibOwner(wallet);
    const dir = path.dirname(pathBerkas('dokumen', 'x'));
    const out = new Set();
    for (const nama of fs.readdirSync(dir)) {
      if (!/^[0-9a-f]{64}\.json$/.test(nama)) continue;
      try { const d = dekripsi(JSON.parse(fs.readFileSync(path.join(dir, nama), 'utf8'))); if (isAddr(d.wallet)) out.add(d.wallet); } catch {}
    }
    return { wallets: [...out] };
  }

  // ── Legalitas toko: dokumen pendukung, lencana, tampilan toko ───
  // NIB (40%) sudah diperiksa saat toko disetujui. Dokumen lain menambah persentase setelah admin memeriksa.
  const JENIS_DOK = { npwp: 15, izin_edar: 15, merek: 10, akta: 10, lokasi: 10 };
  const metaFile = (w) => pathBerkas('legalitas', `${w}.json`);
  function bacaMeta(w) {
    try { return dekripsi(JSON.parse(fs.readFileSync(metaFile(w), 'utf8'))); } catch { return { dok: {} }; }
  }
  function simpanMeta(w, m) { tulisAtomik(metaFile(w), JSON.stringify(enkripsi(m))); }
  function hitungLegalitas(m) {
    let pct = 40; const items = [];
    for (const j of Object.keys(JENIS_DOK)) {
      const d = m.dok && m.dok[j];
      const st = d ? d.status : 'belum';
      if (st === 'terverifikasi') pct += JENIS_DOK[j];
      items.push({ jenis: j, bobot: JENIS_DOK[j], status: st, tidakBerlaku: !!(d && d.tidakBerlaku), ts: d ? d.ts : 0 });
    }
    return { pct, level: pct >= 80 ? 'emas' : pct >= 60 ? 'biru' : 'hijau', items };
  }

  async function legalitasSimpan(req) {
    const body = await bacaBody(req, LIMIT.dokumenBodyBytes);
    const wallet = await verifikasi(req, 'legalitas', body);
    await wajibPenjualAktif(wallet);
    batasi(req, 'legalitas', wallet);
    const j = bacaJson(body);
    const jenis = String(j.jenis || '');
    if (!(jenis in JENIS_DOK)) throw new HttpError(400, 'Jenis dokumen tidak dikenal');
    const tidakBerlaku = jenis === 'izin_edar' && j.tidakBerlaku === true;
    const nomor = bersih(j.nomor, 0, 60, 'Nomor dokumen', true);
    let mime = '';
    if (!tidakBerlaku) {
      if (typeof j.fileBase64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(j.fileBase64)) throw new HttpError(400, 'Berkas dokumen tidak valid');
      const file = Buffer.from(j.fileBase64, 'base64');
      if (file.length === 0 || file.length > LIMIT.dokumenFileBytes) throw new HttpError(413, 'Dokumen kosong atau lebih dari 8 MB');
      if (file.subarray(0, 4).toString('latin1') === '%PDF') mime = 'application/pdf';
      else if (file[0] === 0xFF && file[1] === 0xD8 && file[2] === 0xFF) mime = 'image/jpeg';
      else if (file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4E && file[3] === 0x47) mime = 'image/png';
      else throw new HttpError(400, 'Dokumen harus PDF, JPG, atau PNG');
      tulisAtomik(pathBerkas('legalitas', `${wallet}.${jenis}.json`), JSON.stringify(enkripsi({ mime, fileBase64: j.fileBase64 })));
    }
    const m = bacaMeta(wallet); m.dok = m.dok || {};
    m.dok[jenis] = { status: 'menunggu', nomor, tidakBerlaku, mime, ts: Date.now() };
    simpanMeta(wallet, m);
    return hitungLegalitas(m);
  }

  async function legalitasSaya(req) {
    const wallet = await verifikasi(req, 'saya-legalitas', Buffer.alloc(0));
    return hitungLegalitas(bacaMeta(wallet));
  }

  // Publik: hanya tingkat lencana, tanpa isi dokumen maupun persentase.
  function lencanaPublik(url) {
    const daftar = String(url.searchParams.get('w') || '').split(',').map((x) => x.trim().toLowerCase()).filter(isAddr).slice(0, 60);
    const out = {};
    for (const w of daftar) {
      if (!fs.existsSync(metaFile(w))) continue;
      const h = hitungLegalitas(bacaMeta(w));
      if (h.level !== 'hijau') out[w] = h.level;
    }
    return out;
  }

  async function adminLegalitasDaftar(req, w) {
    const wallet = await verifikasi(req, 'admin-legalitas', Buffer.alloc(0));
    await wajibOwner(wallet);
    if (!isAddr(w)) throw new HttpError(400, 'Wallet tidak valid');
    const m = bacaMeta(w.toLowerCase());
    return { wallet: w.toLowerCase(), ...hitungLegalitas(m), dok: m.dok || {} };
  }

  async function adminLegalitasBerkas(req, kunci) {
    const wallet = await verifikasi(req, 'admin-legalitas-berkas', Buffer.alloc(0));
    await wajibOwner(wallet);
    const mm = /^(0x[0-9a-fA-F]{40})-([a-z_]+)$/.exec(kunci);
    if (!mm || !(mm[2] in JENIS_DOK)) throw new HttpError(400, 'Permintaan tidak valid');
    const f = pathBerkas('legalitas', `${mm[1].toLowerCase()}.${mm[2]}.json`);
    if (!fs.existsSync(f)) throw new HttpError(404, 'Berkas tidak ditemukan');
    return dekripsi(JSON.parse(fs.readFileSync(f, 'utf8')));
  }

  async function adminLegalitasPutus(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'admin-legalitas-putus', body);
    await wajibOwner(wallet);
    const j = bacaJson(body);
    const w = String(j.wallet || '').toLowerCase(), jenis = String(j.jenis || '');
    if (!isAddr(w) || !(jenis in JENIS_DOK)) throw new HttpError(400, 'Permintaan tidak valid');
    const m = bacaMeta(w);
    if (!m.dok || !m.dok[jenis]) throw new HttpError(404, 'Dokumen belum diunggah');
    m.dok[jenis].status = j.ok === true ? 'terverifikasi' : 'ditolak';
    m.dok[jenis].diperiksa = Date.now();
    simpanMeta(w, m);
    return hitungLegalitas(m);
  }

  // Tampilan toko tambahan (foto tampilan dan galeri). Profil dan NIB di blockchain tidak diubah.
  async function tampilanSimpan(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'tampilan', body);
    await wajibPenjualAktif(wallet);
    batasi(req, 'tampilan', wallet);
    const j = bacaJson(body);
    const hx = (v) => String(v || '').replace(/^0x/, '');
    const tampil = hx(j.fotoTampil);
    if (tampil && (!isHex64(tampil) || !cariFoto(tampil))) throw new HttpError(400, 'Foto tampilan belum diunggah');
    const galeri = (Array.isArray(j.galeri) ? j.galeri : []).map(hx);
    if (galeri.length > 6) throw new HttpError(400, 'Galeri maksimal 6 foto');
    if (new Set(galeri).size !== galeri.length) throw new HttpError(400, 'Ada foto yang sama dipakai dua kali');
    for (const g of galeri) if (!isHex64(g) || !cariFoto(g)) throw new HttpError(400, 'Ada foto galeri yang belum diunggah');
    const doc = { fotoTampil: tampil, galeri, sapaan: bersih(j.sapaan, 0, 200, 'Sapaan toko', true), ts: Date.now() };
    tulisAtomik(pathBerkas('tampilan', `${wallet}.json`), JSON.stringify(doc));
    return doc;
  }
  function tampilanBaca(w) {
    if (!isAddr(w)) throw new HttpError(400, 'Wallet tidak valid');
    try { return JSON.parse(fs.readFileSync(pathBerkas('tampilan', `${w.toLowerCase()}.json`), 'utf8')); } catch { return { fotoTampil: '', galeri: [], sapaan: '' }; }
  }

  // ── Tanya jawab publik ─────────────────────────────────────────

  const fileTanya = (id) => pathBerkas('tanya', `${id}.json`);
  function bacaTanya(id) {
    try { return JSON.parse(fs.readFileSync(fileTanya(id), 'utf8')); } catch { return []; }
  }
  function idProduk(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1000000) throw new HttpError(400, 'Nomor produk tidak valid');
    return n;
  }
  async function penjualProduk(id) {
    let w;
    try { w = await deps.getProductSeller(id); }
    catch { throw new HttpError(404, 'Produk tidak ditemukan'); }
    if (!isAddr(w) || /^0x0{40}$/.test(w)) throw new HttpError(404, 'Produk tidak ditemukan');
    return w;
  }
  const maskWallet = (w) => w.slice(0, 6) + '…' + w.slice(-4);

  function tanyaDaftar(id) {
    const daftar = bacaTanya(idProduk(id)).filter((x) => !x.h).map((x) => ({
      n: x.n, w: maskWallet(x.w), t: x.t, ts: x.ts, j: x.j ? { t: x.j.t, ts: x.j.ts } : null,
    }));
    return { daftar };
  }

  async function tanyaKirim(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'tanya', body);
    const j = bacaJson(body);
    const id = idProduk(j.produk);
    const teks = tolakKontak(bersih(j.teks, 5, 300, 'Pertanyaan'));
    const penjual = await penjualProduk(id);
    if (wallet === penjual) throw new HttpError(403, 'Penjual tidak bisa bertanya di produknya sendiri');
    batasi(req, 'tanya', wallet);
    const data = bacaTanya(id);
    if (data.length >= 200) throw new HttpError(429, 'Kolom tanya jawab produk ini sudah penuh');
    if (data.filter((x) => x.w === wallet && !x.j && !x.h).length >= 3) throw new HttpError(429, 'Tunggu penjual menjawab pertanyaanmu sebelumnya');
    const n = data.length ? data[data.length - 1].n + 1 : 1;
    data.push({ n, w: wallet, t: teks, ts: Date.now(), j: null, h: false });
    tulisAtomik(fileTanya(id), JSON.stringify(data));
    return { ok: true, n };
  }

  async function tanyaJawab(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'jawab', body);
    const j = bacaJson(body);
    const id = idProduk(j.produk);
    const penjual = await penjualProduk(id);
    if (wallet !== penjual) throw new HttpError(403, 'Hanya penjual produk ini yang boleh menjawab');
    const teks = tolakKontak(bersih(j.teks, 2, 400, 'Jawaban'));
    batasi(req, 'jawab', wallet);
    const data = bacaTanya(id);
    const item = data.find((x) => x.n === Number(j.n) && !x.h);
    if (!item) throw new HttpError(404, 'Pertanyaan tidak ditemukan');
    if (item.j) throw new HttpError(409, 'Pertanyaan ini sudah dijawab');
    item.j = { t: teks, ts: Date.now() };
    tulisAtomik(fileTanya(id), JSON.stringify(data));
    return { ok: true };
  }

  async function tanyaHapus(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'admin-tanya', body);
    await wajibOwner(wallet);
    const j = bacaJson(body);
    const id = idProduk(j.produk);
    const data = bacaTanya(id);
    const item = data.find((x) => x.n === Number(j.n));
    if (!item) throw new HttpError(404, 'Pertanyaan tidak ditemukan');
    item.h = true;
    tulisAtomik(fileTanya(id), JSON.stringify(data));
    return { ok: true };
  }

  // ── Pesanan: WA penjual, alamat pembeli, ongkir, resi, pelacakan, ulasan ──

  const low = (x) => String(x || '').toLowerCase();
  const hex32 = (h) => low(h).replace(/^0x/, '');
  const kosong = Buffer.alloc(0);

  function idPesanan(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1000000000) throw new HttpError(400, 'Nomor pesanan tidak valid');
    return n;
  }
  function bacaJsonFile(jenis, nama, bawaan) {
    try { return JSON.parse(fs.readFileSync(pathBerkas(jenis, nama), 'utf8')); } catch { return bawaan; }
  }
  function bacaTerenkripsi(jenis, nama) {
    try { return dekripsi(JSON.parse(fs.readFileSync(pathBerkas(jenis, nama), 'utf8'))); } catch { return null; }
  }

  async function muatOrder(id) {
    let o;
    try { o = await deps.getOrder(id); }
    catch (e) { throw (e instanceof HttpError ? e : new HttpError(503, 'Gagal membaca pesanan di blockchain, coba lagi')); }
    if (!o || !isAddr(String(o.buyer)) || /^0x0{40}$/.test(String(o.buyer))) throw new HttpError(404, 'Pesanan tidak ditemukan');
    return {
      id, buyer: low(o.buyer), seller: low(o.seller), productId: Number(o.productId), status: Number(o.status),
      addrHash: hex32(o.addrHash), resiHash: hex32(o.resiHash), courier: Number(o.courier),
      shippedAt: Number(o.shippedAt), deliveredAt: Number(o.deliveredAt),
    };
  }

  function catatMeta(o) {
    const nama = `${o.id}.json`;
    const m = bacaJsonFile('pesanan', nama, null);
    if (m && m.addrHash === o.addrHash) return m;
    const baru = { id: o.id, addrHash: o.addrHash, ts: Date.now() };
    tulisAtomik(pathBerkas('pesanan', nama), JSON.stringify(baru));
    return baru;
  }

  // WA penjual (wajib) + kode pos asal kirim (untuk cek ongkir). Terenkripsi, tidak pernah tampil publik.
  async function waSimpan(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'wa', body);
    let sl;
    try { sl = await deps.getSeller(wallet); }
    catch { throw new HttpError(503, 'Gagal memeriksa status penjual di blockchain, coba lagi'); }
    const st = sl.status;
    if (!st) throw new HttpError(403, 'Daftar sebagai penjual dulu');
    batasi(req, 'wa', wallet);
    const j = bacaJson(body);
    const wa = normalHp(j.wa);
    const kodePosAsal = String(j.kodePosAsal || '').trim();
    if (!/^\d{5}$/.test(kodePosAsal)) throw new HttpError(400, 'Kode pos asal kirim harus 5 angka');
    let lama = null;
    try { lama = dekripsi(JSON.parse(fs.readFileSync(pathBerkas('wa', `${wallet}.json`), 'utf8'))); } catch {}
    const riwayat = (lama && Array.isArray(lama.riwayat)) ? lama.riwayat.slice(-50) : [];
    if (lama && lama.wa && lama.wa !== wa) {
      if (sl.activeOrders > 0) throw new HttpError(409, 'Nomor WhatsApp tidak bisa diganti selama masih ada pesanan berjalan');
      riwayat.push({ wa: lama.wa, ts: lama.ts || 0, diganti: Date.now() });
    }
    tulisAtomik(pathBerkas('wa', `${wallet}.json`), JSON.stringify(enkripsi({ wa, kodePosAsal, ts: Date.now(), riwayat })));
    return { ok: true };
  }
  async function waSaya(req) {
    const wallet = await verifikasi(req, 'saya-wa', Buffer.alloc(0));
    try { const d = dekripsi(JSON.parse(fs.readFileSync(pathBerkas('wa', `${wallet}.json`), 'utf8'))); return { wa: d.wa, kodePosAsal: d.kodePosAsal, riwayat: d.riwayat || [] }; }
    catch { return { wa: '', kodePosAsal: '', riwayat: [] }; }
  }
  async function adminWaRiwayat(req, w) {
    const wallet = await verifikasi(req, 'admin-wa-riwayat', Buffer.alloc(0));
    await wajibOwner(wallet);
    if (!isAddr(w)) throw new HttpError(400, 'Wallet tidak valid');
    try { const d = dekripsi(JSON.parse(fs.readFileSync(pathBerkas('wa', `${low(w)}.json`), 'utf8'))); return { wa: d.wa, riwayat: d.riwayat || [] }; }
    catch { return { wa: '', riwayat: [] }; }
  }
  function waAda(w) {
    if (!isAddr(w)) throw new HttpError(400, 'Alamat wallet tidak valid');
    return { ada: adaBerkas('wa', `${low(w)}.json`) };
  }

  // Alamat pembeli: disimpan terenkripsi, hash-nya dikirim ke kontrak saat membuat pesanan.
  async function alamatSimpan(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'alamat', body);
    batasi(req, 'alamat', wallet);
    const j = bacaJson(body);
    const kodePos = String(j.kodePos || '').trim();
    if (!/^\d{5}$/.test(kodePos)) throw new HttpError(400, 'Kode pos tujuan harus 5 angka');
    const kurir = Number(j.kurir);
    if (!KURIR[kurir]) throw new HttpError(400, 'Kurir tidak dikenal');
    const bundel = {
      wallet,
      nama: bersih(j.nama, 3, 80, 'Nama penerima'),
      hp: normalHp(j.hp),
      alamat: bersih(j.alamat, 10, 250, 'Alamat lengkap'),
      kecamatan: bersih(j.kecamatan, 0, 80, 'Kecamatan', true),
      kota: bersih(j.kota, 2, 80, 'Kota'),
      kodePos,
      kurir,
      catatan: bersih(j.catatan, 0, 150, 'Catatan', true),
      salt: crypto.randomBytes(16).toString('hex'),
    };
    const hash = sha256Hex(JSON.stringify(bundel));
    tulisAtomik(pathBerkas('alamat', `${hash}.json`), JSON.stringify(enkripsi(bundel)));
    return { hash: '0x' + hash };
  }
  function bukaAlamat(addrHash) {
    const a = bacaTerenkripsi('alamat', `${addrHash}.json`);
    if (!a) return null;
    const { salt, wallet, ...sisa } = a; // eslint-disable-line no-unused-vars
    return Object.assign(sisa, { kurirNama: KURIR[a.kurir] ? KURIR[a.kurir].nama : '' });
  }
  function bukaWa(penjual) {
    const d = bacaTerenkripsi('wa', `${penjual}.json`);
    return d ? d.wa : null;
  }
  async function bukaRekening(penjual) {
    let bank;
    try { bank = hex32((await deps.getSeller(penjual)).bankHash); } catch { return null; }
    const d = bacaTerenkripsi('rekening', `${bank}.json`);
    return d ? { bank: d.bank, noRek: d.noRek, atasNama: d.atasNama } : null;
  }

  // Isi yang boleh dibuka sesuai peran dan tahap pesanan.
  async function pesananBuka(req, id) {
    const wallet = await verifikasi(req, 'pesanan', kosong);
    batasi(req, 'pesanan', wallet);
    const o = await muatOrder(id);
    const out = { status: o.status };
    if (wallet === o.buyer) {
      out.peran = 'pembeli';
      if (STATUS_REKENING.has(o.status)) out.rekening = await bukaRekening(o.seller);
      if (STATUS_AKTIF.has(o.status)) out.wa = bukaWa(o.seller);
    } else if (wallet === o.seller) {
      out.peran = 'penjual';
      if (STATUS_AKTIF.has(o.status)) { out.alamat = bukaAlamat(o.addrHash); catatMeta(o); }
    } else {
      throw new HttpError(403, 'Pesanan ini bukan milik wallet ini');
    }
    return out;
  }

  async function adminPesanan(req, id) {
    const wallet = await verifikasi(req, 'admin-pesanan', kosong);
    await wajibOwner(wallet);
    const o = await muatOrder(id);
    return { status: o.status, buyer: o.buyer, seller: o.seller, alamat: bukaAlamat(o.addrHash), waPenjual: bukaWa(o.seller) };
  }

  // Cek ongkir lewat Biteship. Hanya kurir yang kita dukung; hasil di-cache 10 menit.
  const cacheOngkir = new Map();
  async function ongkirHitung(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'ongkir', body);
    batasi(req, 'ongkir', wallet);
    const j = bacaJson(body);
    const produk = idProduk(j.produk);
    const qty = Number(j.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw new HttpError(400, 'Jumlah tidak valid');
    const kodePos = String(j.kodePos || '').trim();
    if (!/^\d{5}$/.test(kodePos)) throw new HttpError(400, 'Kode pos tujuan harus 5 angka');
    let l;
    try { l = await deps.getListing(produk); } catch { throw new HttpError(404, 'Produk tidak ditemukan'); }
    if (!l || !l.buyable) throw new HttpError(404, 'Produk tidak tersedia');
    const spek = bacaJsonFile('spek', `${hex32(l.metaHash)}.json`, null);
    if (!spek || !spek.beratGram) throw new HttpError(502, 'Spesifikasi produk tidak ditemukan');
    const wa = bacaTerenkripsi('wa', `${l.seller}.json`);
    if (!wa) throw new HttpError(409, 'Penjual belum melengkapi data pengiriman');
    const kunci = [wa.kodePosAsal, kodePos, spek.beratGram, qty, l.priceIDR].join(':');
    const c = cacheOngkir.get(kunci);
    if (c && c.exp > Date.now()) return { daftar: c.daftar };
    let r;
    try {
      r = await deps.biteship('POST', '/v1/rates/couriers', {
        origin_postal_code: Number(wa.kodePosAsal), destination_postal_code: Number(kodePos),
        couriers: Object.values(KURIR).map((k) => k.kode).join(','),
        items: [{ name: String(spek.nama || 'Barang').slice(0, 60), value: l.priceIDR, weight: spek.beratGram, quantity: qty }],
      });
    } catch (e) { throw (e instanceof HttpError ? e : new HttpError(503, 'Cek ongkir gagal, coba lagi')); }
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.pricing)) throw new HttpError(502, 'Ongkir ke kode pos ini tidak tersedia');
    const kodeKeId = {}; for (const [id, k] of Object.entries(KURIR)) kodeKeId[k.kode] = Number(id);
    const daftar = r.json.pricing
      .filter((x) => kodeKeId[x.courier_code] && Number.isFinite(Number(x.price)) && Number(x.price) > 0)
      .map((x) => ({
        kurir: kodeKeId[x.courier_code], nama: KURIR[kodeKeId[x.courier_code]].nama,
        layanan: String(x.courier_service_name || x.courier_service_code || '').slice(0, 40),
        estimasi: String(x.duration || '').slice(0, 30), harga: Math.round(Number(x.price)),
      }))
      .sort((a, b) => a.harga - b.harga).slice(0, 12);
    if (!daftar.length) throw new HttpError(502, 'Tidak ada kurir yang melayani rute ini');
    cacheOngkir.set(kunci, { daftar, exp: Date.now() + 10 * 60000 });
    return { daftar };
  }

  // Resi: penjual mengirim resi ke sini dulu (mendapat hash), baru memanggil markShipped di kontrak.
  const fileResi = (id) => `${id}.json`;
  function indeksResi() { return bacaJsonFile('resi', 'indeks.json', {}); }

  async function cekResi(kodeKurir, resi) {
    let r;
    try { r = await deps.biteship('GET', `/v1/trackings/${encodeURIComponent(resi)}/couriers/${kodeKurir}`); }
    catch { return { ok: null }; }
    if (r.status === 200 && r.json && r.json.success !== false && r.json.status) {
      const riwayat = (Array.isArray(r.json.history) ? r.json.history : []).slice(-30).map((x) => ({
        t: String(x.note || '').slice(0, 200), ts: Date.parse(x.updated_at) || null,
      }));
      return { ok: true, status: petaStatus(r.json.status), riwayat };
    }
    if (r.status === 400 || r.status === 404) return { ok: false };
    return { ok: null };
  }

  async function resiKirim(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'resi', body);
    batasi(req, 'resi', wallet);
    const j = bacaJson(body);
    const id = idPesanan(j.order);
    const kurir = Number(j.kurir);
    if (!KURIR[kurir]) throw new HttpError(400, 'Kurir tidak dikenal');
    const resi = String(j.resi || '').toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{6,30}$/.test(resi)) throw new HttpError(400, 'Nomor resi hanya huruf dan angka, 6 sampai 30 karakter');
    const o = await muatOrder(id);
    if (wallet !== o.seller) throw new HttpError(403, 'Hanya penjual pesanan ini');
    if (o.status !== ST.BuyerLocked) throw new HttpError(409, 'Resi hanya bisa diisi setelah pembeli mengunci jaminan');
    const hash = sha256Hex(`${KURIR[kurir].kode}|${resi}`);
    const idx = indeksResi();
    if (idx[hash] && idx[hash] !== id) throw new HttpError(409, 'Nomor resi ini sudah dipakai di pesanan lain');
    const cek = await cekResi(KURIR[kurir].kode, resi);
    idx[hash] = id;
    tulisAtomik(pathBerkas('resi', 'indeks.json'), JSON.stringify(idx));
    const f = {
      id, kurir, resi, hash, ts: Date.now(), cek: Date.now(), terbaca: cek.ok === true,
      status: cek.ok ? cek.status : 'resi_dibuat', riwayat: cek.ok ? cek.riwayat : [], dilaporTs: 0, selesai: false,
    };
    tulisAtomik(pathBerkas('resi', fileResi(id)), JSON.stringify(f));
    catatMeta(o);
    return { hash: '0x' + hash, terbaca: f.terbaca };
  }

  // Ambil status terbaru dari kurir, lalu laporkan "Sampai" ke kontrak (sekali, dengan coba ulang).
  async function segarkan(id, f, o) {
    const cek = await cekResi(KURIR[f.kurir].kode, f.resi);
    f.cek = Date.now();
    if (cek.ok) { f.terbaca = true; f.status = cek.status; f.riwayat = cek.riwayat; }
    if (f.status === 'sampai' && o.status === ST.Shipped && Date.now() - (f.dilaporTs || 0) > 30 * 60000) {
      try { await deps.markDelivered(id); f.dilaporTs = Date.now(); }
      catch (e) { console.error('[bazaar] markDelivered gagal', id, e && e.message); }
    }
    tulisAtomik(pathBerkas('resi', fileResi(id)), JSON.stringify(f));
    return f;
  }

  async function pesananLacak(req, id) {
    const wallet = await verifikasi(req, 'pesanan', kosong);
    batasi(req, 'pesanan', wallet);
    const o = await muatOrder(id);
    let admin = false;
    if (wallet !== o.buyer && wallet !== o.seller) {
      try { admin = wallet === (await deps.getOwner()); } catch { admin = false; }
      if (!admin) throw new HttpError(403, 'Pesanan ini bukan milik wallet ini');
    }
    const out = { status: o.status, resi: null, lacak: null, ulasan: null };
    let f = bacaJsonFile('resi', fileResi(id), null);
    if (f && f.hash !== o.resiHash) { out.tidakCocok = true; f = null; }
    if (f) {
      if (o.status === ST.Shipped && Date.now() - f.cek > JEDA_LIHAT) f = await segarkan(id, f, o);
      out.resi = { kurir: KURIR[f.kurir].nama, no: f.resi, terbaca: !!f.terbaca };
      out.lacak = { kode: f.status, label: LABEL_LACAK[f.status] || '', riwayat: f.riwayat, cek: f.cek };
    }
    if (wallet === o.buyer && o.status === ST.Completed) {
      const u = bacaUlasan(o.seller).find((x) => x.o === id);
      if (u) out.ulasan = { b: u.b, g: u.g, ts: u.ts, d: u.d, bisaUbah: Date.now() - u.ts < JEDA_EDIT_ULASAN };
    }
    return out;
  }

  // Pemantau latar: cek kurir untuk pesanan yang sedang dikirim, dan hapus alamat yang sudah lewat masa simpan.
  async function pantau() {
    for (const nama of fs.readdirSync(pathBerkas('resi', ''))) {
      if (!/^\d+\.json$/.test(nama)) continue;
      const id = Number(nama.replace('.json', ''));
      const f = bacaJsonFile('resi', nama, null);
      if (!f || f.selesai) continue;
      let o;
      try { o = await muatOrder(id); } catch { continue; }
      if (o.status >= ST.Delivered) { f.selesai = true; tulisAtomik(pathBerkas('resi', nama), JSON.stringify(f)); continue; }
      if (o.status !== ST.Shipped || f.hash !== o.resiHash) continue;
      if (Date.now() - f.cek < JEDA_PANTAU) continue;
      await segarkan(id, f, o);
    }
  }

  async function sapuAlamat() {
    const now = Date.now();
    for (const nama of fs.readdirSync(pathBerkas('alamat', ''))) { // alamat yatim: tak ada pesanan yang pernah membukanya
      const fl = pathBerkas('alamat', nama);
      try { if (now - fs.statSync(fl).mtimeMs > 90 * HARI) fs.unlinkSync(fl); } catch { /* abaikan */ }
    }
    for (const nama of fs.readdirSync(pathBerkas('pesanan', ''))) {
      if (!/^\d+\.json$/.test(nama)) continue;
      const m = bacaJsonFile('pesanan', nama, null);
      if (!m || m.alamatDihapus) continue;
      if (!m.selesaiTs) {
        let o;
        try { o = await muatOrder(m.id); } catch { continue; }
        if (!STATUS_SELESAI.has(o.status)) continue;
        m.selesaiTs = now;
      }
      if (now - m.selesaiTs > SIMPAN_ALAMAT) {
        try { fs.unlinkSync(pathBerkas('alamat', `${m.addrHash}.json`)); } catch { /* sudah tidak ada */ }
        m.alamatDihapus = true;
      }
      tulisAtomik(pathBerkas('pesanan', nama), JSON.stringify(m));
    }
  }

  // Ulasan: dikaitkan ke pesanan yang selesai. Disimpan per penjual, bisa diubah 30 hari dengan tanda "diubah".
  const bacaUlasan = (penjual) => bacaJsonFile('ulasan', `s-${penjual}.json`, []);
  async function ulasanKirim(req) {
    const body = await bacaBody(req, LIMIT.jsonBytes);
    const wallet = await verifikasi(req, 'ulasan', body);
    batasi(req, 'ulasan', wallet);
    const j = bacaJson(body);
    const id = idPesanan(j.order);
    const b = Number(j.bintang);
    if (!Number.isInteger(b) || b < 1 || b > 5) throw new HttpError(400, 'Bintang harus 1 sampai 5');
    const g = Array.isArray(j.tags) ? j.tags.map(String) : [];
    if (g.length > 4 || new Set(g).size !== g.length || g.some((t) => !SEMUA_TAG.has(t))) throw new HttpError(400, 'Pilihan kata-kata ulasan tidak valid (maks. 4)');
    const o = await muatOrder(id);
    if (wallet !== o.buyer) throw new HttpError(403, 'Hanya pembeli pesanan ini');
    if (o.status !== ST.Completed) throw new HttpError(409, 'Ulasan dibuka setelah pesanan selesai');
    const arr = bacaUlasan(o.seller);
    const ada = arr.find((x) => x.o === id);
    if (ada) {
      if (Date.now() - ada.ts > JEDA_EDIT_ULASAN) throw new HttpError(409, 'Ulasan sudah tidak bisa diubah (lewat 30 hari)');
      ada.b = b; ada.g = g; ada.d = true;
    } else {
      arr.push({ o: id, p: o.productId, w: o.buyer, b, g, ts: Date.now(), d: false });
    }
    tulisAtomik(pathBerkas('ulasan', `s-${o.seller}.json`), JSON.stringify(arr));
    return { ok: true, diubah: !!ada };
  }
  function ringkasUlasan(arr) {
    const n = arr.length;
    const rata = n >= 3 ? Math.round((arr.reduce((a, x) => a + x.b, 0) / n) * 10) / 10 : null; // rata-rata tampil setelah 3 ulasan
    const tag = {};
    for (const x of arr) for (const t of x.g) tag[t] = (tag[t] || 0) + 1;
    const daftar = arr.slice().sort((a, c) => c.ts - a.ts).slice(0, 30).map((x) => ({ b: x.b, g: x.g, ts: x.ts, d: x.d, w: maskWallet(x.w) }));
    return { jumlah: n, rata, tag, daftar };
  }
  async function ulasanProduk(id) {
    id = idProduk(id);
    const penjual = await penjualProduk(id);
    return ringkasUlasan(bacaUlasan(penjual).filter((x) => x.p === id));
  }
  function ulasanToko(w) {
    if (!isAddr(w)) throw new HttpError(400, 'Alamat wallet tidak valid');
    return ringkasUlasan(bacaUlasan(low(w)));
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

    if (req.method === 'GET' && a === 'lencana' && !b) return kirimJson(res, 200, lencanaPublik(url));
    if (req.method === 'GET' && a === 'tampilan' && b && !c) return kirimJson(res, 200, tampilanBaca(b));
    if (req.method === 'GET' && a === 'saya' && b === 'wa' && !c) return kirimJson(res, 200, await waSaya(req));
    if (req.method === 'GET' && a === 'admin' && b === 'wa-riwayat' && c) return kirimJson(res, 200, await adminWaRiwayat(req, c));
    if (req.method === 'GET' && a === 'saya' && b === 'legalitas' && !c) return kirimJson(res, 200, await legalitasSaya(req));
    if (req.method === 'GET' && a === 'tanya' && b && !c) return kirimJson(res, 200, tanyaDaftar(b));
    if (req.method === 'GET' && a === 'wa' && b === 'ada' && c) return kirimJson(res, 200, waAda(c));
    if (req.method === 'GET' && a === 'ulasan' && b === 'produk' && c) return kirimJson(res, 200, await ulasanProduk(c));
    if (req.method === 'GET' && a === 'ulasan' && b === 'toko' && c) return kirimJson(res, 200, ulasanToko(c));
    if (req.method === 'GET' && a === 'pesanan' && b && c === 'buka') return kirimJson(res, 200, await pesananBuka(req, idPesanan(b)));
    if (req.method === 'GET' && a === 'pesanan' && b && c === 'lacak') return kirimJson(res, 200, await pesananLacak(req, idPesanan(b)));

    // Tulis
    if (req.method === 'POST') {
      if (a === 'tanya' && !b) return kirimJson(res, 200, await tanyaKirim(req));
      if (a === 'tanya' && b === 'jawab') return kirimJson(res, 200, await tanyaJawab(req));
      if (a === 'tanya' && b === 'hapus') return kirimJson(res, 200, await tanyaHapus(req));
      if (a === 'wa' && !b) return kirimJson(res, 200, await waSimpan(req));
      if (a === 'alamat' && !b) return kirimJson(res, 200, await alamatSimpan(req));
      if (a === 'ongkir' && !b) return kirimJson(res, 200, await ongkirHitung(req));
      if (a === 'resi' && !b) return kirimJson(res, 200, await resiKirim(req));
      if (a === 'ulasan' && !b) return kirimJson(res, 200, await ulasanKirim(req));
      if (a === 'foto' && b) return kirimJson(res, 200, await fotoUnggah(req, b));
      if (a === 'sesi' && !b) return kirimJson(res, 200, await sesiBuat(req));
      if (a === 'profil' && !b) return kirimJson(res, 200, await profilSimpan(req));
      if (a === 'spek' && !b) return kirimJson(res, 200, await spekSimpan(req));
      if (a === 'dokumen' && !b) return kirimJson(res, 200, await dokumenSimpan(req));
      if (a === 'legalitas' && !b) return kirimJson(res, 200, await legalitasSimpan(req));
      if (a === 'tampilan' && !b) return kirimJson(res, 200, await tampilanSimpan(req));
      if (a === 'admin' && b === 'legalitas-putus' && !c) return kirimJson(res, 200, await adminLegalitasPutus(req));
      if (a === 'rekening' && !b) return kirimJson(res, 200, await rekeningSimpan(req));
    }

    // Khusus wallet Dev
    if (req.method === 'GET' && a === 'admin' && b === 'daftar' && c === 'penjual') return kirimJson(res, 200, await adminDaftarPenjual(req));
    if (req.method === 'GET' && a === 'admin' && b === 'legalitas' && c) return kirimJson(res, 200, await adminLegalitasDaftar(req, c));
    if (req.method === 'GET' && a === 'admin' && b === 'legalitas-berkas' && c) return kirimJson(res, 200, await adminLegalitasBerkas(req, c));
    if (req.method === 'GET' && a === 'admin' && b === 'pesanan' && c) return kirimJson(res, 200, await adminPesanan(req, idPesanan(c)));
    if (req.method === 'GET' && a === 'admin' && b && c) return kirimJson(res, 200, await adminBaca(req, b, c));

    throw new HttpError(404, 'Tidak ditemukan');
  }

  const server = http.createServer(async (req, res) => {
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
  server.pantau = pantau;
  server.sapuAlamat = sapuAlamat;
  return server;
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
  const aman = (f) => () => { f().catch((e) => console.error('[bazaar] tugas latar gagal:', e && e.message)); };
  if (CFG.escrow) {
    setInterval(aman(server.pantau), 20 * 60 * 1000).unref();
    setInterval(aman(server.sapuAlamat), 6 * 3600 * 1000).unref();
  }
  server.listen(CFG.port, '127.0.0.1', () => {
    console.log(`[bazaar] jalan di 127.0.0.1:${CFG.port}, data di ${CFG.dataDir}`);
  });
  return server;
}

module.exports = { TAG_ULASAN, KURIR, ST, sesiAktif, createApp, CFG, LIMIT, buatPesan, periksaFoto, tolakKontak, siapkanFolder, muatIndeks, dekripsi };

if (require.main === module) start();
