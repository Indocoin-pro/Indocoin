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
  { id: 'pintu',       name: 'Pintu',           site: 'https://pintu.co.id',            level: 'harga'  },
  { id: 'triv',        name: 'Triv',            site: 'https://www.triv.co.id',             level: 'tautan' },
  { id: 'pluang',      name: 'Pluang',          site: 'https://pluang.com',             level: 'tautan' },
  { id: 'bittime',     name: 'Bittime',         site: 'https://bittime.com',            level: 'harga'  },
  { id: 'stockbit',    name: 'Stockbit Crypto', site: 'https://www.crypto.stockbit.com',           level: 'tautan' },
  { id: 'luno',        name: 'Luno',            site: 'https://www.luno.com',           level: 'harga'  },
  { id: 'reku',        name: 'Reku',            site: 'https://www.reku.id',            level: 'harga'  },
  { id: 'nanovest',    name: 'Nanovest',        site: 'https://www.nanovest.io',        level: 'tautan' },
  { id: 'bitwyre',     name: 'Bitwyre',         site: 'https://www.bitwyre.id',         level: 'tautan' },
  { id: 'ajaib',       name: 'Ajaib Kripto',    site: 'https://kripto.ajaib.co.id',     level: 'tautan' },
  { id: 'astal',       name: 'Astal',           site: 'https://www.astal.co.id', level: 'tautan' },
  { id: 'bitwewe',     name: 'Bitwewe',         site: 'https://www.bitwewe.co.id', level: 'tautan' },
  { id: 'btse',        name: 'BTSE Indonesia',  site: 'https://www.btse.id', level: 'harga' },
  { id: 'coinvest',    name: 'Coinvest',        site: 'https://www.pedagangkripto.com', level: 'tautan' },
  { id: 'coinx',       name: 'CoinX',           site: 'https://www.coinx.co.id', level: 'tautan' },
  { id: 'cyra',        name: 'Cyra',            site: 'https://www.cyra.exchange', level: 'tautan' },
  { id: 'floq',        name: 'Floq',            site: 'https://floq.co.id', level: 'tautan' },
  { id: 'koinsayang',  name: 'Koin Sayang',     site: 'https://www.koinsayang.com', level: 'tautan' },
  { id: 'kriptosukses',name: 'Kripto Sukses',   site: 'https://kriptosukses.com', level: 'tautan' },
  { id: 'mobee',       name: 'Mobee',           site: 'https://mobee.com', level: 'tautan' },
  { id: 'naga',        name: 'Naga Exchange',   site: 'https://nagaexchange.co.id', level: 'tautan' },
  { id: 'samuel',      name: 'Samuel Kripto',   site: 'https://www.samuelkripto.com', level: 'tautan' },
  { id: 'upbit',       name: 'Upbit Indonesia', site: 'https://id.upbit.com', level: 'harga' },
  { id: 'usenobi',     name: 'Usenobi',         site: 'https://usenobi.com', level: 'tautan' }
];
