/**
 * INDOCOIN WALLET BRIDGE
 * Support semua wallet: MetaMask, Trust Wallet, dll
 * Via WalletConnect QR Code - jalan di Chrome, WebView APK, DApps browser
 * 
 * CARA PAKAI: Tambahkan di setiap HTML sebelum script lain:
 * <script src="wallet-bridge.js"></script>
 */

(function() {
  'use strict';

  // ===== KONFIGURASI =====
  const BSC_CHAIN_ID = 56;
  const BSC_RPC = 'https://bsc-dataseed.binance.org/';
  const WC_PROJECT_ID = '58821258cd5f963d7324df3832dde2fd'; // WalletConnect Project ID

  // Cek apakah sudah ada injected wallet (DApps browser)
  const hasInjectedWallet = typeof window.ethereum !== 'undefined' && window.ethereum !== null;

  // Jika sudah ada injected wallet (Trust Wallet DApps / MetaMask), pakai langsung
  if (hasInjectedWallet) {
    console.log('[WalletBridge] Injected wallet terdeteksi, pakai langsung.');
    // Override alert untuk MetaMask detection
    const originalAlert = window.alert;
    window.alert = function(msg) {
      if (msg && msg.includes('Install MetaMask')) {
        // Jangan tampilkan alert MetaMask, sudah ada wallet
        return;
      }
      originalAlert(msg);
    };
    return; // Sudah ada wallet, tidak perlu WalletConnect
  }

  // ===== TIDAK ADA INJECTED WALLET =====
  // Tampilkan UI pemilihan wallet
  console.log('[WalletBridge] Tidak ada injected wallet, siapkan WalletConnect.');

  // Inject WalletConnect + Web3Modal dari CDN
  function loadScript(src, callback) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = callback;
    s.onerror = function() { console.error('[WalletBridge] Gagal load:', src); };
    document.head.appendChild(s);
  }

  // State wallet
  let wcProvider = null;
  let wcConnected = false;

  // Override connectWallet function
  const originalConnectWallet = window.connectWallet;

  window.connectWallet = async function() {
    // Cek lagi apakah ada injected wallet sekarang
    if (typeof window.ethereum !== 'undefined' && window.ethereum !== null) {
      if (originalConnectWallet) {
        return originalConnectWallet();
      }
    }

    // Tampilkan modal pilihan wallet
    showWalletModal();
  };

  // ===== MODAL PEMILIHAN WALLET =====
  function showWalletModal() {
    // Hapus modal lama jika ada
    const oldModal = document.getElementById('wb-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'wb-modal';
    modal.innerHTML = `
      <div id="wb-overlay" style="
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:rgba(0,0,0,0.85);z-index:99999;
        display:flex;align-items:center;justify-content:center;
        font-family:'Orbitron',sans-serif;
      ">
        <div style="
          background:#0d0b10;border:1px solid rgba(200,146,42,0.4);
          border-radius:16px;padding:24px;width:90%;max-width:360px;
          box-shadow:0 0 40px rgba(200,146,42,0.2);
        ">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <div style="color:#c8922a;font-size:13px;font-weight:700;letter-spacing:2px;">
              HUBUNGKAN WALLET
            </div>
            <button id="wb-close" style="
              background:none;border:none;color:#666;font-size:20px;cursor:pointer;
            ">✕</button>
          </div>

          <!-- WalletConnect QR -->
          <button class="wb-btn" id="wb-wc" style="
            width:100%;padding:14px;margin-bottom:10px;
            background:rgba(58,116,229,0.1);border:1px solid rgba(58,116,229,0.3);
            border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;
            cursor:pointer;display:flex;align-items:center;gap:12px;
          ">
            <span style="font-size:24px;">📱</span>
            <div style="text-align:left;">
              <div style="font-weight:700;margin-bottom:2px;">WALLETCONNECT</div>
              <div style="font-size:10px;color:#888;">Scan QR dari wallet manapun</div>
            </div>
          </button>

          <!-- Trust Wallet Deep Link -->
          <button class="wb-btn" id="wb-trust" style="
            width:100%;padding:14px;margin-bottom:10px;
            background:rgba(51,117,255,0.1);border:1px solid rgba(51,117,255,0.3);
            border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;
            cursor:pointer;display:flex;align-items:center;gap:12px;
          ">
            <span style="font-size:24px;">🛡️</span>
            <div style="text-align:left;">
              <div style="font-weight:700;margin-bottom:2px;">TRUST WALLET</div>
              <div style="font-size:10px;color:#888;">Buka di Trust Wallet DApps</div>
            </div>
          </button>

          <!-- MetaMask Deep Link -->
          <button class="wb-btn" id="wb-mm" style="
            width:100%;padding:14px;margin-bottom:10px;
            background:rgba(246,133,27,0.1);border:1px solid rgba(246,133,27,0.3);
            border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;
            cursor:pointer;display:flex;align-items:center;gap:12px;
          ">
            <span style="font-size:24px;">🦊</span>
            <div style="text-align:left;">
              <div style="font-weight:700;margin-bottom:2px;">METAMASK</div>
              <div style="font-size:10px;color:#888;">Buka di MetaMask</div>
            </div>
          </button>

          <div style="text-align:center;color:#444;font-size:9px;margin-top:12px;letter-spacing:1px;">
            BSC MAINNET · CHAIN ID 56
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close button
    document.getElementById('wb-close').onclick = function() {
      modal.remove();
    };

    // Close on overlay click
    document.getElementById('wb-overlay').onclick = function(e) {
      if (e.target === this) modal.remove();
    };

    // WalletConnect button
    document.getElementById('wb-wc').onclick = function() {
      modal.remove();
      connectViaWalletConnect();
    };

    // Trust Wallet button
    document.getElementById('wb-trust').onclick = function() {
      modal.remove();
      openInTrustWallet();
    };

    // MetaMask button
    document.getElementById('wb-mm').onclick = function() {
      modal.remove();
      openInMetaMask();
    };
  }

  // ===== BUKA DI TRUST WALLET =====
  function openInTrustWallet() {
    const currentUrl = encodeURIComponent(window.location.href);
    const trustDeepLink = 'https://link.trustwallet.com/open_url?coin_id=60&url=' + currentUrl;
    window.location.href = trustDeepLink;
  }

  // ===== BUKA DI METAMASK =====
  function openInMetaMask() {
    const currentUrl = window.location.href.replace('https://', '');
    const mmDeepLink = 'https://metamask.app.link/dapp/' + currentUrl;
    window.location.href = mmDeepLink;
  }

  // ===== WALLETCONNECT QR =====
  async function connectViaWalletConnect() {
    try {
      showLoading('Memuat WalletConnect...');

      // Load WalletConnect SDK
      await loadScriptAsync('https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.13.0/dist/umd/index.min.js');

      hideLoading();

      const { EthereumProvider } = window.WalletConnectEthereumProvider || window['@walletconnect/ethereum-provider'];

      if (!EthereumProvider) {
        showError('WalletConnect gagal dimuat. Coba buka di DApps browser wallet.');
        return;
      }

      showLoading('Menghubungkan wallet...');

      const provider = await EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [BSC_CHAIN_ID],
        showQrModal: true,
        qrModalOptions: {
          themeMode: 'dark',
          themeVariables: {
            '--wcm-accent-color': '#c8922a',
            '--wcm-background-color': '#0d0b10',
          }
        },
        metadata: {
          name: 'INDOCOIN',
          description: 'Indonesian Community Supporting Global Crypto',
          url: 'https://indocoin.id',
          icons: ['https://indocoin.id/logo_256.png']
        }
      });

      await provider.connect();

      // Set sebagai window.ethereum
      window.ethereum = provider;
      wcProvider = provider;
      wcConnected = true;

      hideLoading();

      // Panggil fungsi connectWallet original
      if (typeof window._originalConnectWallet === 'function') {
        window._originalConnectWallet();
      } else {
        // Trigger event untuk memberitahu website
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        window.dispatchEvent(new CustomEvent('walletConnected', {
          detail: { accounts, provider }
        }));
        // Reload halaman agar website mendeteksi wallet
        window.location.reload();
      }

    } catch (err) {
      hideLoading();
      if (err.message && err.message.includes('User rejected')) {
        console.log('[WalletBridge] User menolak koneksi');
      } else {
        console.error('[WalletBridge] Error:', err);
        showError('Gagal connect. Coba buka di Trust Wallet DApps browser.');
      }
    }
  }

  // ===== HELPER FUNCTIONS =====
  function loadScriptAsync(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function showLoading(msg) {
    const old = document.getElementById('wb-loading');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'wb-loading';
    el.innerHTML = `
      <div style="
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:rgba(0,0,0,0.85);z-index:99999;
        display:flex;align-items:center;justify-content:center;
        font-family:'Orbitron',sans-serif;
      ">
        <div style="text-align:center;color:#c8922a;">
          <div style="font-size:32px;margin-bottom:16px;">⏳</div>
          <div style="font-size:11px;letter-spacing:2px;">${msg}</div>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }

  function hideLoading() {
    const el = document.getElementById('wb-loading');
    if (el) el.remove();
  }

  function showError(msg) {
    const old = document.getElementById('wb-error');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'wb-error';
    el.innerHTML = `
      <div style="
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:rgba(0,0,0,0.85);z-index:99999;
        display:flex;align-items:center;justify-content:center;
        font-family:'Orbitron',sans-serif;
      ">
        <div style="
          background:#0d0b10;border:1px solid rgba(255,80,80,0.4);
          border-radius:16px;padding:24px;width:90%;max-width:360px;
          text-align:center;
        ">
          <div style="font-size:32px;margin-bottom:16px;">❌</div>
          <div style="color:#ff5050;font-size:11px;letter-spacing:1px;margin-bottom:16px;">${msg}</div>
          <button onclick="this.parentElement.parentElement.parentElement.remove()" style="
            background:rgba(200,146,42,0.2);border:1px solid #c8922a;
            color:#c8922a;padding:10px 24px;border-radius:8px;
            cursor:pointer;font-size:11px;letter-spacing:1px;
          ">TUTUP</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }

  // Override alert untuk DApps detection
  const originalAlert = window.alert;
  window.alert = function(msg) {
    if (msg && (msg.includes('Install MetaMask') || msg.includes('dApp browser'))) {
      // Tampilkan modal kita sendiri
      showWalletModal();
      return;
    }
    originalAlert(msg);
  };

  // Simpan referensi original connectWallet
  if (typeof window.connectWallet === 'function') {
    window._originalConnectWallet = window.connectWallet;
  }

  console.log('[WalletBridge] Siap! Multi-wallet support aktif.');

})();
