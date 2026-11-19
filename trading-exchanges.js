/*
 * INDOCOIN Trading — lapisan adapter exchange
 * Menambah exchange baru = tambah satu objek adapter di EXCHANGES dengan antarmuka yang sama:
 *   meta:     { id, name, site, license, status: 'live' | 'soon' }
 *   pairs()   -> [{ id, base, quote, name, pricePrecision }]
 *   tickers() -> { [pairId]: { last, high, low, volIdr, changePct } }
 *   depth(id) -> { bids: [[harga, jumlah]], asks: [[harga, jumlah]] }
 *   candles(id, tf) -> [{ t, o, h, l, c, v }]   (tf: '15M' | '1J' | '4J' | '1H')
 * Semua angka dikembalikan sebagai Number. Hanya data publik (tanpa API key).
 */
(function (root) {
  'use strict';

  var num = function (x) { var n = Number(x); return isFinite(n) ? n : 0; };

  /* ---------------- INDODAX (API publik resmi) ---------------- */
  var ROOT = (typeof window !== 'undefined' && window.INDC_PROXY_ROOT) || 'https://trading-api.indocoin.id';
  var INDODAX_BASE = (typeof window !== 'undefined' && window.INDC_INDODAX_BASE) || (ROOT + '/indodax');
  var LUNO_BASE = ROOT + '/luno', TOKO_BASE = ROOT + '/tokocrypto';
  function getFrom(base, path) {
    return fetch(base + path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  var INDODAX_TF = { '15M': { tf: '15', sec: 900 }, '1J': { tf: '60', sec: 3600 }, '4J': { tf: '240', sec: 14400 }, '1H': { tf: '1D', sec: 86400 } };

  function getJSON(path) {
    return fetch(INDODAX_BASE + path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  var indodax = {
    meta: { id: 'indodax', name: 'Indodax', site: 'https://indodax.com', license: 'Pedagang aset kripto berizin OJK', status: 'live', chart: true },

    pairs: function () {
      return getJSON('/api/pairs').then(function (list) {
        return (list || []).filter(function (p) {
          return String(p.base_currency).toLowerCase() === 'idr' && !p.is_maintenance && !p.is_market_suspended;
        }).map(function (p) {
          var base = String(p.traded_currency || '').toLowerCase();
          var id = String(p.symbol || (base + 'idr')).toLowerCase();
          return { id: id, base: base.toUpperCase(), quote: 'IDR', name: p.description || base.toUpperCase(), pricePrecision: num(p.price_precision) };
        });
      });
    },

    tickers: function () {
      return getJSON('/api/summaries').then(function (j) {
        var out = {}, t = j.tickers || {}, p24 = j.prices_24h || {};
        Object.keys(t).forEach(function (key) {
          var id = key.replace('_', '');
          var last = num(t[key].last), open = num(p24[id]);
          out[id] = { last: last, high: num(t[key].high), low: num(t[key].low), vol: num(t[key].vol_idr), volIdr: num(t[key].vol_idr), changePct: open > 0 ? (last - open) / open * 100 : 0 };
        });
        return out;
      });
    },

    depth: function (id) {
      return getJSON('/api/depth/' + id).then(function (j) {
        var map = function (a) { return (a || []).slice(0, 8).map(function (r) { return [num(r[0]), num(r[1])]; }); };
        return { bids: map(j.buy), asks: map(j.sell) };
      });
    },

    candles: function (id, tf) {
      var cfg = INDODAX_TF[tf] || INDODAX_TF['1J'];
      var to = Math.floor(Date.now() / 1000), from = to - cfg.sec * 70;
      return getJSON('/tradingview/history_v2?from=' + from + '&to=' + to + '&tf=' + cfg.tf + '&symbol=' + id.toUpperCase()).then(function (arr) {
        return (arr || []).slice(-60).map(function (c) {
          var t = num(c.Time); if (t > 1e12) t = Math.floor(t / 1000);
          return { t: t, o: num(c.Open), h: num(c.High), l: num(c.Low), c: num(c.Close), v: num(c.Volume) };
        });
      });
    }
  };

  /* ---------------- LUNO (API publik; grafik butuh login -> tanpa grafik) ---------------- */
  var LUNO_QUOTES = ['IDR', 'USDT'];
  var lunoBase = function (c) { c = String(c || '').toUpperCase(); return c === 'XBT' ? 'BTC' : c; };
  var luno = {
    meta: { id: 'luno', name: 'Luno', site: 'https://www.luno.com', license: 'Pedagang aset kripto berizin OJK', status: 'live', chart: false },
    pairs: function () {
      return getFrom(LUNO_BASE, '/markets').then(function (j) {
        return (j.markets || []).filter(function (m) {
          return m.trading_status === 'ACTIVE' && LUNO_QUOTES.indexOf(String(m.counter_currency).toUpperCase()) > -1;
        }).map(function (m) {
          var b = lunoBase(m.base_currency);
          return { id: String(m.market_id).toLowerCase(), base: b, quote: String(m.counter_currency).toUpperCase(), name: b, pricePrecision: num(m.price_scale) };
        });
      });
    },
    tickers: function () {
      return getFrom(LUNO_BASE, '/tickers').then(function (j) {
        var out = {};
        (j.tickers || []).forEach(function (t) {
          var last = num(t.last_trade);
          out[String(t.pair).toLowerCase()] = { last: last, high: null, low: null, vol: num(t.rolling_24_hour_volume) * last, changePct: null };
        });
        return out;
      });
    },
    depth: function (id) {
      return getFrom(LUNO_BASE, '/orderbook?pair=' + id.toUpperCase()).then(function (j) {
        var map = function (a) { return (a || []).slice(0, 8).map(function (r) { return [num(r.price), num(r.volume)]; }); };
        return { bids: map(j.bids), asks: map(j.asks) };
      });
    },
    candles: function () { return Promise.resolve([]); }
  };

  /* ---------------- TOKOCRYPTO (API publik gaya Binance; tanpa ticker 24 jam -> dihitung dari candle harian) ---------------- */
  var TOKO_QUOTES = ['IDR', 'USDT'];
  var TOKO_POPULAR = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'TKO'];
  var TOKO_TF = { '15M': '15m', '1J': '1h', '4J': '4h', '1H': '1d' };
  var tokoPairs = [];
  var unwrap = function (j) { return (j && j.data !== undefined) ? j.data : j; };
  var toko = {
    meta: { id: 'tokocrypto', name: 'Tokocrypto', site: 'https://www.tokocrypto.com', license: 'Pedagang aset kripto berizin OJK', status: 'live', chart: true },
    pairs: function () {
      return getFrom(TOKO_BASE, '/symbols').then(function (j) {
        var list = (unwrap(j) || {}).list || [];
        var out = list.filter(function (s) {
          var q = String(s.quoteAsset).toUpperCase();
          return s.type === 1 && s.spotTradingEnable !== 0 && TOKO_QUOTES.indexOf(q) > -1 && (q === 'IDR' || TOKO_POPULAR.indexOf(String(s.baseAsset).toUpperCase()) > -1);
        }).map(function (s) {
          var b = String(s.baseAsset).toUpperCase(), q = String(s.quoteAsset).toUpperCase();
          return { id: (b + q).toLowerCase(), base: b, quote: q, name: b, pricePrecision: 0 };
        });
        tokoPairs = out; return out;
      });
    },
    tickers: function () {
      var run = tokoPairs.length ? Promise.resolve(tokoPairs) : toko.pairs();
      return run.then(function (list) {
        var out = {};
        return Promise.all(list.slice(0, 12).map(function (p) {
          return getFrom(TOKO_BASE, '/klines?symbol=' + p.id.toUpperCase() + '&interval=1d&limit=2').then(function (j) {
            var k = unwrap(j) || [], d = k[k.length - 1]; if (!d) return;
            var o = num(d[1]), c = num(d[4]);
            out[p.id] = { last: c, high: num(d[2]), low: num(d[3]), vol: num(d[7]), changePct: o > 0 ? (c - o) / o * 100 : 0 };
          }).catch(function () {});
        })).then(function () { return out; });
      });
    },
    depth: function (id) {
      return getFrom(TOKO_BASE, '/depth?symbol=' + id.toUpperCase() + '&limit=10').then(function (j) {
        var d = unwrap(j) || {};
        var map = function (a) { return (a || []).slice(0, 8).map(function (r) { return [num(r[0]), num(r[1])]; }); };
        return { bids: map(d.bids), asks: map(d.asks) };
      });
    },
    candles: function (id, tf) {
      return getFrom(TOKO_BASE, '/klines?symbol=' + id.toUpperCase() + '&interval=' + (TOKO_TF[tf] || '1h') + '&limit=60').then(function (j) {
        return (unwrap(j) || []).map(function (c) {
          return { t: Math.floor(num(c[0]) / 1000), o: num(c[1]), h: num(c[2]), l: num(c[3]), c: num(c[4]), v: num(c[5]) };
        });
      });
    }
  };

  /* ---------------- DEMO (hanya untuk preview; aktif lewat #demo) ---------------- */
  function seeded(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  var DEMO_PAIRS = [['btc', 'Bitcoin', 1380000000], ['eth', 'Ethereum', 52000000], ['usdt', 'Tether', 16250], ['bnb', 'BNB', 14500000], ['sol', 'Solana', 2900000], ['doge', 'Dogecoin', 3600], ['xrp', 'XRP', 38000], ['ada', 'Cardano', 9800]];
  var demo = {
    meta: { id: 'indodax', name: 'Indodax', site: 'https://indodax.com', license: 'Pedagang aset kripto berizin OJK', status: 'live', chart: true },
    pairs: function () { return Promise.resolve(DEMO_PAIRS.map(function (p) { return { id: p[0] + 'idr', base: p[0].toUpperCase(), quote: 'IDR', name: p[1], pricePrecision: 0 }; })); },
    tickers: function () {
      var out = {}; DEMO_PAIRS.forEach(function (p, i) { var r = seeded(i + 5); var last = p[2] * (1 + (r() - .5) * .02); out[p[0] + 'idr'] = { last: last, high: last * 1.02, low: last * .97, vol: (20 - i) * 1.3e9, volIdr: (20 - i) * 1.3e9, changePct: (r() - .45) * 6 }; });
      return Promise.resolve(out);
    },
    depth: function (id) {
      var base = (DEMO_PAIRS.filter(function (p) { return p[0] + 'idr' === id; })[0] || DEMO_PAIRS[0])[2], r = seeded(9);
      var mk = function (d) { var p = base, a = []; for (var i = 0; i < 8; i++) { p = p * (1 + d * (0.0004 + r() * 0.0006)); a.push([p, r() * 3 + 0.1]); } return a; };
      return Promise.resolve({ bids: mk(-1), asks: mk(1) });
    },
    candles: function (id, tf) {
      var base = (DEMO_PAIRS.filter(function (p) { return p[0] + 'idr' === id; })[0] || DEMO_PAIRS[0])[2], r = seeded(id.length * 7 + tf.length), p = base * .97, out = [], now = Math.floor(Date.now() / 1000);
      for (var i = 0; i < 60; i++) { var o = p, c = o * (1 + (r() - .47) * .012); out.push({ t: now - (60 - i) * 3600, o: o, h: Math.max(o, c) * (1 + r() * .004), l: Math.min(o, c) * (1 - r() * .004), c: c, v: r() * 100 }); p = c; }
      return Promise.resolve(out);
    }
  };

  /* Hanya platform dengan level 'harga' di platforms.js yang perlu adapter di sini. */
  var EXCHANGES = { indodax: indodax, luno: luno, tokocrypto: toko };

  var api = { EXCHANGES: EXCHANGES, DEMO: demo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INDC_EXCHANGES = api;
})(typeof window !== 'undefined' ? window : globalThis);
