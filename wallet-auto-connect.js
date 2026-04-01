/**
 * INDOCOIN — Auto Connect Wallet
 * Simpan wallet ke localStorage setelah connect di halaman manapun.
 * Halaman lain akan otomatis connect saat dibuka.
 */

const WALLET_KEY = 'indocoin_wallet';

// ── Simpan wallet ke localStorage ──
window._saveWallet = function(address) {
  if (address && ethers.utils.isAddress(address)) {
    localStorage.setItem(WALLET_KEY, address.toLowerCase());
  }
};

// ── Hapus wallet dari localStorage (saat disconnect) ──
window._clearWallet = function() {
  localStorage.removeItem(WALLET_KEY);
};

// ── Ambil wallet tersimpan ──
window._getSavedWallet = function() {
  return localStorage.getItem(WALLET_KEY);
};

// ── Auto connect saat halaman dibuka ──
window.addEventListener('load', async () => {
  // Tunggu ethers.js siap
  if (typeof ethers === 'undefined') return;

  const savedWallet = window._getSavedWallet();
  if (!savedWallet) return;
  if (!window.ethereum) return;

  try {
    // Cek apakah wallet yang tersimpan masih aktif di MetaMask
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    // eth_accounts tidak minta popup — hanya baca yang sudah diizinkan
    if (!accounts || accounts.length === 0) return;

    const currentAddr = accounts[0].toLowerCase();

    // Wallet yang aktif sama dengan yang tersimpan — auto connect
    if (currentAddr === savedWallet) {
      // Cari fungsi connect wallet di halaman ini dan panggil
      if (typeof window.connectWallet === 'function') {
        await window.connectWallet();
      } else if (typeof window.initWallet === 'function') {
        await window.initWallet();
      }
    } else {
      // Wallet berbeda — update localStorage dengan wallet baru
      window._saveWallet(accounts[0]);
      if (typeof window.connectWallet === 'function') {
        await window.connectWallet();
      } else if (typeof window.initWallet === 'function') {
        await window.initWallet();
      }
    }
  } catch(e) {
    // Gagal diam-diam — tidak ganggu halaman
    console.warn('wallet-auto-connect:', e.message || e);
  }
});

// ── Dengarkan perubahan akun di MetaMask ──
if (window.ethereum) {
  window.ethereum.on('accountsChanged', (accounts) => {
    if (accounts.length === 0) {
      // User disconnect dari MetaMask
      window._clearWallet();
      location.reload();
    } else {
      // User ganti akun
      window._saveWallet(accounts[0]);
      location.reload();
    }
  });

  window.ethereum.on('chainChanged', () => {
    location.reload();
  });
}


// ── INTERCEPTOR GLOBAL v2 ────────────────────────────────────
// Tangkap wallet dari SEMUA halaman termasuk halaman trade
(function() {
  if (!window.ethereum) {
    // Coba lagi setelah ethereum tersedia
    window.addEventListener('load', function() {
      if (window.ethereum) setupInterceptor();
    });
    return;
  }
  setupInterceptor();

  function setupInterceptor() {
    // 1. Override eth_requestAccounts & eth_accounts
    const _orig = window.ethereum.request.bind(window.ethereum);
    window.ethereum.request = async function(args) {
      const result = await _orig(args);
      if (args && (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts')) {
        if (result && result.length > 0) {
          localStorage.setItem('indocoin_wallet', result[0].toLowerCase());
        }
      }
      return result;
    };

    // 2. Event accountsChanged
    window.ethereum.on('accountsChanged', function(accounts) {
      if (accounts && accounts.length > 0) {
        localStorage.setItem('indocoin_wallet', accounts[0].toLowerCase());
      }
    });

    // 3. Patch initWallet jika ada di halaman — jalankan setelah DOM ready
    document.addEventListener('DOMContentLoaded', function() {
      // Coba ambil wallet yang sudah tersimpan dan patch fungsi initWallet
      const _origInit = window.initWallet;
      if (typeof _origInit === 'function') {
        window.initWallet = async function(addr) {
          if (addr) localStorage.setItem('indocoin_wallet', addr.toLowerCase());
          return _origInit.apply(this, arguments);
        };
      }

      // Coba baca eth_accounts langsung saat halaman load
      setTimeout(async function() {
        try {
          if (window.ethereum) {
            const accs = await window.ethereum.request({ method: 'eth_accounts' });
            if (accs && accs.length > 0) {
              localStorage.setItem('indocoin_wallet', accs[0].toLowerCase());
            }
          }
        } catch(e) {}
      }, 1000);
    });
  }
})();
