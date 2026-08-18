/**
 * INDOCOIN SERVICE WORKER
 * Setiap ada update file, ganti VERSION menjadi angka baru
 * Contoh: "1.0" → "1.1" → "1.2" dst
 * Semua user akan otomatis dapat versi terbaru!
 */

const VERSION = "138.8";
const CACHE_NAME = "indocoin-v" + VERSION;

const CACHE_FILES = [
  "/",
  "/index.html",
  "/indocoin-master",
  "/indc-market.html",
  "/dashboard.html",
  "/indocoin-city.html",
  "/earn.html",
  "/permainan.html",
  "/referral.html",
  "/analytics.html",
  "/agrikultur.html",
  "/assets.html",
  "/arisan.html",
  "/arbibot.html",
  "/guild.html",
  "/guruku.html",
  "/indowar.html",
  "/battle-arena.html",
  "/staking-1.html",
  "/staking-3-v3.html",
  "/growth-lock-staking.html",
  "/garudaforcemissionstaking.html",
  "/flexiyieldstaking.html",
  "/dynamiclevelstaking.html",
  "/boostlevelstaking.html",
  "/autocompoundstaking.html",
  "/lockeddiamondstaking.html",
  "/pointvaultstaking.html",
  "/referralpowerstaking.html",
  "/sanjaya.html",
  "/sanjaya-race.html",
  "/sanjaya-result.html",
  "/sanjaya-arena.html",
  "/sanjaya-rank.html",
  "/sanjaya-history.html",
  "/leaderboard.html",
  "/landing.html",
  "/kolaborasi.html",
  "/kontribusi.html",
  "/solidaritas.html",
  "/dokumen.html",
  "/panel-mitra",
  "/prediksi.html",
  "/presale.html",
  "/profile.html",
  "/pvp-duel.html",
  "/trade.html",
  "/swap.html",
  "/phantom-box-trade.html",
  "/ppob.html",
  "/clash-trade.html",
  "/battle-arena-trade.html",
  "/cycle-trade.html",
  "/shadow-copy-trade.html",
  "/chart.html",
  "/oracle-trade.html",
  "/blitz-trade.html",
  "/three-trade.html",
  "/three-chart.html",
  "/wave-trade.html",
  "/delta-trade.html",
  "/stairway-to-heaven.html",
  "/league-trade.html",
  "/signal-trade.html",
  "/time-vault-trade.html",
  "/undian.html",
  "/member-vip.html",
  "/member-sync.html",
  "/wallet.html",
  "/tabungan.html",
  "/tournament.html",
  "/syaratdanketentuan.html",
  "/sanjaya-icon.png",
  "/indowar-icon.png",
  "/sanjaya-sound.js",
  "/sanjaya-tutorial.js",
  "/sanjaya-ui.js",
  "/sanjaya-notif.js",
  "/sanjaya-notif-inject.js",
  "/brainclash.html",
  "/brainclash-room.html",
  "/brainclash-history.html",
  "/brainclash-notif.js",
  "/brainclash-icon.svg",
  "/airdrop.html",
  "/airdrop-widget.js",
  "/airdrop-questions.js",
  "/wallet-bridge.js",
  "/indc-staking.html",
  "/dev-panel.html",
  "/advertise.html",
  "/advertiser.html",
  "/merchant.html",
  "/merchant-pay.html",
  "/merchant-qr.html",
  "/token-lock-tracker.html",
  "/welcome.html",
  "/premium-games.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_FILES).catch((err) => {
        console.warn("[SW] Cache addAll error:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log("[SW] Hapus cache lama:", key);
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.url.startsWith("chrome-extension")) return;
  if (event.request.url.includes("firebase") || 
    event.request.url.includes("googleapis") ||
    event.request.url.includes("ethers") ||
    event.request.url.includes("binance.org") ||
    event.request.url.includes("cdn.binance") || 
    event.request.url.includes("madkidgames") ||
    event.request.url.includes("api.indocoin.id")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});
