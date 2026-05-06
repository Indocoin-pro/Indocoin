/**
 * INDOCOIN WALLET BRIDGE v2
 * Support semua wallet via WalletConnect AppKit
 */

(function() {
  'use strict';

  const WC_PROJECT_ID = '58821258cd5f963d7324df3832dde2fd';
  const BSC_CHAIN_ID = 56;

  const hasInjectedWallet = typeof window.ethereum !== 'undefined' && window.ethereum !== null;

  if (hasInjectedWallet) {
    const orig = window.alert;
    window.alert = function(msg) {
      if (msg && msg.includes('Install MetaMask')) return;
      orig(msg);
    };
    return;
  }

  // Override connectWallet
  window.connectWallet = async function() {
    if (typeof window.ethereum !== 'undefined') {
      if (window._origConnectWallet) return window._origConnectWallet();
    }
    showWalletModal();
  };

  function showWalletModal() {
    const old = document.getElementById('wb-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'wb-modal';
    modal.innerHTML = `
      <div id="wb-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:'Orbitron',sans-serif;">
        <div style="background:#0d0b10;border:1px solid rgba(200,146,42,0.4);border-radius:16px;padding:24px;width:90%;max-width:360px;box-shadow:0 0 40px rgba(200,146,42,0.2);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <div style="color:#c8922a;font-size:13px;font-weight:700;letter-spacing:2px;">HUBUNGKAN WALLET</div>
            <button id="wb-close" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;">✕</button>
          </div>
          <button id="wb-wc" style="width:100%;padding:14px;margin-bottom:10px;background:rgba(58,116,229,0.1);border:1px solid rgba(58,116,229,0.3);border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;cursor:pointer;display:flex;align-items:center;gap:12px;">
            <span style="font-size:24px;">📱</span>
            <div style="text-align:left;">
              <div style="font-weight:700;margin-bottom:2px;">WALLETCONNECT</div>
              <div style="font-size:10px;color:#888;">Scan QR dari wallet manapun</div>
            </div>
          </button>
          <button id="wb-trust" style="width:100%;padding:14px;margin-bottom:10px;background:rgba(51,117,255,0.1);border:1px solid rgba(51,117,255,0.3);border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;cursor:pointer;display:flex;align-items:center;gap:12px;">
            <span style="font-size:24px;">🛡️</span>
            <div style="text-align:left;">
              <div style="font-weight:700;margin-bottom:2px;">TRUST WALLET</div>
              <div style="font-size:10px;color:#888;">Buka di Trust Wallet DApps</div>
            </div>
          </button>
          <button id="wb-mm" style="width:100%;padding:14px;margin-bottom:10px;background:rgba(246,133,27,0.1);border:1px solid rgba(246,133,27,0.3);border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;cursor:pointer;display:flex;align-items:center;gap:12px;">
            <span style="font-size:24px;">🦊</span>
            <div style="text-align:left;">
              <div style="font-weight:700;margin-bottom:2px;">METAMASK</div>
              <div style="font-size:10px;color:#888;">Buka di MetaMask</div>
            </div>
          </button>
          <div style="text-align:center;color:#444;font-size:9px;margin-top:12px;letter-spacing:1px;">BSC MAINNET · CHAIN ID 56</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('wb-close').onclick = () => modal.remove();
    document.getElementById('wb-overlay').onclick = (e) => { if (e.target.id === 'wb-overlay') modal.remove(); };
    document.getElementById('wb-wc').onclick = () => { modal.remove(); connectWC(); };
    document.getElementById('wb-trust').onclick = () => { modal.remove(); openTrust(); };
    document.getElementById('wb-mm').onclick = () => { modal.remove(); openMM(); };
  }

  function openTrust() {
    const url = encodeURIComponent(window.location.href);
    window.location.href = 'https://link.trustwallet.com/open_url?coin_id=60&url=' + url;
  }

  function openMM() {
    const url = window.location.href.replace('https://', '');
    window.location.href = 'https://metamask.app.link/dapp/' + url;
  }

  async function connectWC() {
    showLoading('Memuat WalletConnect...');
    try {
      // Gunakan WalletConnect universal link approach
      const wcUri = await generateWCUri();
      hideLoading();
      if (wcUri) {
        showQRModal(wcUri);
      } else {
        showError('Gagal generate QR. Coba gunakan Trust Wallet atau MetaMask.');
      }
    } catch(e) {
      hideLoading();
      console.error('[WalletBridge]', e);
      showError('Gagal connect. Gunakan Trust Wallet atau MetaMask.');
    }
  }

  async function generateWCUri() {
    try {
      // Load WalletConnect SignClient
      await loadScript('https://cdn.jsdelivr.net/npm/@walletconnect/sign-client@2.13.0/dist/index.umd.js');

      if (!window.SignClient) throw new Error('SignClient tidak tersedia');

      const client = await window.SignClient.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: 'INDOCOIN',
          description: 'Indonesian Community Supporting Global Crypto',
          url: 'https://indocoin.id',
          icons: ['https://indocoin.id/logo_256.png']
        }
      });

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['eth_sendTransaction', 'eth_signTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData'],
            chains: ['eip155:56'],
            events: ['chainChanged', 'accountsChanged']
          }
        }
      });

      // Handle approval
      approval().then(async (session) => {
        const accounts = session.namespaces.eip155.accounts;
        const address = accounts[0].split(':')[2];

        // Buat provider dari WalletConnect
        window._wcSession = session;
        window._wcClient = client;
        window._wcAddress = address;

        // Reload untuk update UI
        closeQRModal();
        showSuccess('Wallet terhubung! ' + address.substring(0,6) + '...' + address.substring(38));
        setTimeout(() => window.location.reload(), 2000);
      }).catch(e => {
        console.log('[WalletBridge] User rejected atau timeout');
        closeQRModal();
      });

      return uri;
    } catch(e) {
      console.error('[WalletBridge] WC Error:', e);
      return null;
    }
  }

  function showQRModal(uri) {
    const old = document.getElementById('wb-qr');
    if (old) old.remove();

    // Generate QR menggunakan API
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(uri);

    const modal = document.createElement('div');
    modal.id = 'wb-qr';
    modal.innerHTML = `
      <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:'Orbitron',sans-serif;">
        <div style="background:#0d0b10;border:1px solid rgba(200,146,42,0.4);border-radius:16px;padding:24px;width:90%;max-width:360px;text-align:center;">
          <div style="color:#c8922a;font-size:13px;font-weight:700;letter-spacing:2px;margin-bottom:16px;">SCAN QR CODE</div>
          <div style="background:#fff;padding:12px;border-radius:12px;display:inline-block;margin-bottom:16px;">
            <img src="${qrUrl}" width="220" height="220" alt="WalletConnect QR">
          </div>
          <div style="color:#888;font-size:10px;letter-spacing:1px;margin-bottom:16px;">Buka wallet kamu → scan QR ini</div>
          <div style="color:#555;font-size:9px;margin-bottom:16px;">Trust Wallet · MetaMask · TokenPocket · dll</div>
          <button onclick="document.getElementById('wb-qr').remove()" style="background:rgba(200,146,42,0.2);border:1px solid #c8922a;color:#c8922a;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:11px;letter-spacing:1px;">TUTUP</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function closeQRModal() {
    const m = document.getElementById('wb-qr');
    if (m) m.remove();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
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
    el.innerHTML = `<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:'Orbitron',sans-serif;"><div style="text-align:center;color:#c8922a;"><div style="font-size:32px;margin-bottom:16px;">⏳</div><div style="font-size:11px;letter-spacing:2px;">${msg}</div></div></div>`;
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
    el.innerHTML = `<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:'Orbitron',sans-serif;"><div style="background:#0d0b10;border:1px solid rgba(255,80,80,0.4);border-radius:16px;padding:24px;width:90%;max-width:360px;text-align:center;"><div style="font-size:32px;margin-bottom:16px;">❌</div><div style="color:#ff5050;font-size:11px;letter-spacing:1px;margin-bottom:16px;">${msg}</div><button onclick="this.closest('#wb-error').remove()" style="background:rgba(200,146,42,0.2);border:1px solid #c8922a;color:#c8922a;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:11px;letter-spacing:1px;">TUTUP</button></div></div>`;
    document.body.appendChild(el);
  }

  function showSuccess(msg) {
    const el = document.createElement('div');
    el.innerHTML = `<div style="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#0d0b10;border:1px solid #2ea86a;border-radius:12px;padding:12px 24px;z-index:99999;color:#2ea86a;font-size:11px;letter-spacing:1px;font-family:'Orbitron',sans-serif;">✅ ${msg}</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  const orig = window.alert;
  window.alert = function(msg) {
    if (msg && (msg.includes('Install MetaMask') || msg.includes('dApp browser'))) {
      showWalletModal(); return;
    }
    orig(msg);
  };

  if (typeof window.connectWallet === 'function') {
    window._origConnectWallet = window.connectWallet;
  }

  console.log('[WalletBridge v2] Siap!');
})();
