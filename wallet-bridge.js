/**
 * INDOCOIN WALLET BRIDGE v3
 * Support: Trust Wallet, MetaMask, TokenPocket via deep link
 */

(function() {
  'use strict';

  const hasInjectedWallet = typeof window.ethereum !== 'undefined' && window.ethereum !== null;

  if (hasInjectedWallet) {
    const orig = window.alert;
    window.alert = function(msg) {
      if (msg && msg.includes('Install MetaMask')) return;
      orig(msg);
    };
    return;
  }

  if (typeof window.connectWallet === 'function') {
    window._origConnectWallet = window.connectWallet;
  }

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

          <button id="wb-tp" style="width:100%;padding:14px;margin-bottom:10px;background:rgba(41,182,246,0.1);border:1px solid rgba(41,182,246,0.3);border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;cursor:pointer;display:flex;align-items:center;gap:12px;">
            <img src="https://cdn.jsdelivr.net/gh/trustwallet/assets/dapps/tokenpocket.pro.png" width="36" height="36" style="border-radius:8px;object-fit:contain;flex-shrink:0;" onerror="this.outerHTML='<span style=\'font-size:24px;\'>💎</span>'">
            <div style="text-align:left;">
              <div style="font-weight:700;margin-bottom:2px;">TOKENPOCKET</div>
              <div style="font-size:10px;color:#888;">Wallet DeFi terpopuler di Indonesia</div>
            </div>
          </button>

          <button id="wb-trust" style="width:100%;padding:14px;margin-bottom:10px;background:rgba(51,117,255,0.1);border:1px solid rgba(51,117,255,0.3);border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;cursor:pointer;display:flex;align-items:center;gap:12px;">
            <img src="https://cdn.jsdelivr.net/gh/trustwallet/assets/dapps/trustwallet.com.png" width="36" height="36" style="border-radius:8px;object-fit:contain;flex-shrink:0;" onerror="this.outerHTML='<span style=\'font-size:24px;\'>🛡️</span>'">
            <div style="text-align:left;">
              <div style="font-weight:700;margin-bottom:2px;">TRUST WALLET</div>
              <div style="font-size:10px;color:#888;">Buka di Trust Wallet DApps</div>
            </div>
          </button>

          <button id="wb-mm" style="width:100%;padding:14px;margin-bottom:10px;background:rgba(246,133,27,0.1);border:1px solid rgba(246,133,27,0.3);border-radius:12px;color:#fff;font-size:12px;letter-spacing:1px;cursor:pointer;display:flex;align-items:center;gap:12px;">
            <img src="https://cdn.jsdelivr.net/gh/trustwallet/assets/dapps/metamask.io.png" width="36" height="36" style="border-radius:8px;object-fit:contain;flex-shrink:0;" onerror="this.outerHTML='<span style=\'font-size:24px;\'>🦊</span>'">
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
    document.getElementById('wb-tp').onclick = () => { modal.remove(); openTokenPocket(); };
    document.getElementById('wb-trust').onclick = () => { modal.remove(); openTrust(); };
    document.getElementById('wb-mm').onclick = () => { modal.remove(); openMM(); };
  }

  function openTokenPocket() {
    const url = encodeURIComponent(window.location.href);
    const tpDeepLink = 'tpdapp://open?params={"url":"' + decodeURIComponent(url) + '","chain":"BSC"}';
    window.location.href = tpDeepLink;
    setTimeout(() => {
      window.location.href = 'https://www.tokenpocket.pro/en/download/app';
    }, 2000);
  }

  function openTrust() {
    const url = encodeURIComponent(window.location.href);
    window.location.href = 'https://link.trustwallet.com/open_url?coin_id=60&url=' + url;
  }

  function openMM() {
    const url = window.location.href.replace('https://', '');
    window.location.href = 'https://metamask.app.link/dapp/' + url;
  }

  const orig = window.alert;
  window.alert = function(msg) {
    if (msg && (msg.includes('Install MetaMask') || msg.includes('dApp browser'))) {
      showWalletModal(); return;
    }
    orig(msg);
  };

  console.log('[WalletBridge v3] Siap!');
})();
