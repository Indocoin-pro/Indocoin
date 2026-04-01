/**
 * INDOCOIN — Auto Connect Wallet v3
 * Support ethers v5 dan v6
 */

const WALLET_KEY = 'indocoin_wallet';

// Support ethers v5 & v6
function _isAddress(addr) {
  try {
    if (typeof ethers === 'undefined') return addr && addr.startsWith('0x') && addr.length === 42;
    if (ethers.utils && ethers.utils.isAddress) return ethers.utils.isAddress(addr); // v5
    if (ethers.isAddress) return ethers.isAddress(addr); // v6
    return addr && addr.startsWith('0x') && addr.length === 42;
  } catch(e) { return false; }
}

window._saveWallet = function(address) {
  if (address) localStorage.setItem(WALLET_KEY, address.toLowerCase());
};
window._clearWallet = function() { localStorage.removeItem(WALLET_KEY); };
window._getSavedWallet = function() { return localStorage.getItem(WALLET_KEY); };

// Auto connect
async function _doAutoConnect() {
  const savedWallet = window._getSavedWallet();
  if (!savedWallet) return;
  if (!window.ethereum) return;

  try {
    // Coba eth_accounts dulu (silent, no popup)
    let accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);

    // Jika kosong, coba eth_requestAccounts (di DApp browser auto-approve tanpa popup)
    if (!accounts || accounts.length === 0) {
      accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }).catch(() => []);
    }

    if (!accounts || accounts.length === 0) return;

    // Simpan wallet baru jika berbeda
    window._saveWallet(accounts[0]);

    // Panggil fungsi connect halaman ini
    if (typeof window.connectWallet === 'function') {
      await window.connectWallet();
    } else if (typeof window.initWallet === 'function') {
      await window.initWallet();
    }
  } catch(e) {
    // Gagal diam-diam
  }
}

// Jalankan saat load dengan retry
window.addEventListener('load', () => {
  setTimeout(_doAutoConnect, 300);
  setTimeout(_doAutoConnect, 1500);
});

// Interceptor — simpan wallet setiap kali ada request
(function() {
  if (!window.ethereum) {
    window.addEventListener('load', setupInterceptor);
    return;
  }
  setupInterceptor();

  function setupInterceptor() {
    if (!window.ethereum) return;
    const _orig = window.ethereum.request.bind(window.ethereum);
    window.ethereum.request = async function(args) {
      const result = await _orig(args);
      if (args && (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts')) {
        if (result && result.length > 0) window._saveWallet(result[0]);
      }
      return result;
    };
    window.ethereum.on('accountsChanged', (accs) => {
      if (accs && accs.length > 0) window._saveWallet(accs[0]);
    });
  }
})();
