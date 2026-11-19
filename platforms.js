/*
 * INDOCOIN Trading — daftar platform yang tampil di layar depan menu Trading.
 * Menambah platform = tambah satu baris. Aturan:
 *   level: 'harga'  -> sudah terintegrasi (halaman harga/chart di Indocoin), wajib ada adapter di trading-exchanges.js
 *          'tautan' -> hanya tombol "Buka situs" (isi site)
 *          'segera' -> belum ada tautan (site kosong), tampil "Segera"
 * Hanya cantumkan platform yang ada di whitelist OJK (PAKD berizin). Cek ulang berkala di ojk.go.id.
 * Nama saja, tanpa logo (logo exchange dipakai hanya dengan izin mereka).
 */
window.INDC_PLATFORMS = [
  { id: 'indodax',     name: 'Indodax',         site: 'https://indodax.com',            level: 'harga'  },
  { id: 'tokocrypto',  name: 'Tokocrypto',      site: 'https://www.tokocrypto.com',     level: 'harga'  },
  { id: 'pintu',       name: 'Pintu',           site: 'https://pintu.co.id',            level: 'tautan' },
  { id: 'triv',        name: 'Triv',            site: 'https://triv.co.id',             level: 'tautan' },
  { id: 'pluang',      name: 'Pluang',          site: 'https://pluang.com',             level: 'tautan' },
  { id: 'bittime',     name: 'Bittime',         site: 'https://bittime.com',            level: 'harga'  },
  { id: 'stockbit',    name: 'Stockbit Crypto', site: 'https://stockbit.com',           level: 'tautan' },
  { id: 'luno',        name: 'Luno',            site: 'https://www.luno.com',           level: 'harga'  },
  { id: 'ajaib',       name: 'Ajaib Kripto',    site: 'https://kripto.ajaib.co.id',     level: 'tautan' },
  { id: 'astal',       name: 'Astal',           site: '', level: 'segera' },
  { id: 'bitwewe',     name: 'Bitwewe',         site: '', level: 'segera' },
  { id: 'btse',        name: 'BTSE Indonesia',  site: '', level: 'segera' },
  { id: 'bybit',       name: 'Bybit Indonesia', site: '', level: 'segera' },
  { id: 'coinvest',    name: 'Coinvest',        site: '', level: 'segera' },
  { id: 'coinx',       name: 'CoinX',           site: '', level: 'segera' },
  { id: 'cyra',        name: 'Cyra',            site: '', level: 'segera' },
  { id: 'floq',        name: 'Floq',            site: '', level: 'segera' },
  { id: 'koinsayang',  name: 'Koin Sayang',     site: '', level: 'segera' },
  { id: 'kriptosukses',name: 'Kripto Sukses',   site: '', level: 'segera' },
  { id: 'mobee',       name: 'Mobee',           site: '', level: 'segera' },
  { id: 'naga',        name: 'Naga Exchange',   site: '', level: 'segera' },
  { id: 'samuel',      name: 'Samuel Kripto',   site: '', level: 'segera' },
  { id: 'upbit',       name: 'Upbit Indonesia', site: '', level: 'segera' },
  { id: 'usenobi',     name: 'Usenobi',         site: '', level: 'segera' }
];
