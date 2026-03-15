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
