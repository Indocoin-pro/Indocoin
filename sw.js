/**
 * INDOCOIN SERVICE WORKER
 * Setiap ada update file, ganti VERSION menjadi angka baru
 * Contoh: "1.0" → "1.1" → "1.2" dst
 * Semua user akan otomatis dapat versi terbaru!
 */

const VERSION = "49.8";
const CACHE_NAME = "indocoin-v" + VERSION;

// File yang di-cache
const CACHE_FILES = [
  "/",
  "/index.html",
  "/dashboard.html",
  "/earn.html",
  "/permainan.html",
  "/referral.html",
  "/analytics.html",
  "/assets.html",
  "/arisan.html",
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
  "/prediksi.html",
  "/presale.html",
  "/profile.html",
  "/pvp-duel.html",
  "/trade.html",
  "/swap.html",
  "/phantom-box-trade.html",
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
  "/vip.html",
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
  "/indc-staking.html",
  "/dev-panel.html",
];

// ── INSTALL: cache semua file ──
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_FILES).catch((err) => {
        console.warn("[SW] Cache addAll error:", err);
      });
    })
  );
  // Langsung aktif tanpa tunggu tab lama ditutup
  self.skipWaiting();
});

// ── ACTIVATE: hapus cache lama ──
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
  // Ambil kontrol semua tab yang sudah terbuka
  self.clients.claim();
});

// ── FETCH: Network first, fallback ke cache ──
self.addEventListener("fetch", (event) => {
  // Skip non-GET dan chrome-extension
  if (event.request.method !== "GET") return;
  if (event.request.url.startsWith("chrome-extension")) return;
  if (event.request.url.includes("firebase") || 
      event.request.url.includes("googleapis") ||
      event.request.url.includes("ethers") ||
      event.request.url.includes("cdn")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Simpan response terbaru ke cache
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Kalau offline, pakai cache
        return caches.match(event.request);
      })
  );
});

// ── MESSAGE: force update dari halaman ──
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});
