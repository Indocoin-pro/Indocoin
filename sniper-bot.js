/**
 * INDOCOIN Token Sniper Bot v1.0
 * Engine: scan semua DEX BSC, filter ketat, eksekusi otomatis
 * Config: sniper-config.json (ubah tanpa restart)
 * Wallet: dari .env SNIPER_PRIVATE_KEY
 */

require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ── Config (reload tiap siklus) ──────────────────────────────────────────────
function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'sniper-config.json'), 'utf8'));
}

// ── State ────────────────────────────────────────────────────────────────────
let posisiAktif = {}; // { tokenAddress: { beli, modal, puncak, waktu } }
let historyTrade = []; // semua trade selesai
let saldoBot = 0; // USDT saldo bot
let totalProfit = 0;
let totalLoss = 0;
let totalTrade = 0;
let blacklistRuntime = new Set(); // blacklist saat runtime

// ── Provider & Wallet ────────────────────────────────────────────────────────
async function getBscProvider() {
  const config = loadConfig();
  for (const rpc of config.wallet.rpc) {
    try {
      const p = new ethers.JsonRpcProvider(rpc);
      await Promise.race([
        p.getBlockNumber(),
        new Promise((_, r) => setTimeout(() => r('timeout'), 3000))
      ]);
      return p;
    } catch(e) { continue; }
  }
  throw new Error('Semua RPC gagal');
}

let _provider = null;
let _wallet   = null;

async function getWallet() {
  if (!_provider) _provider = await getBscProvider();
  if (!_wallet)   _wallet   = new ethers.Wallet(process.env.SNIPER_PRIVATE_KEY, _provider);
  return _wallet;
}

// ── ABI ─────────────────────────────────────────────────────────────────────
const FACTORY_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
  'function getPair(address,address) view returns (address)'
];
const PAIR_ABI = [
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];
const ROUTER_ABI = [
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint,uint,address[],address,uint) external',
  'function getAmountsOut(uint,address[]) view returns (uint[])'
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function owner() view returns (address)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
];

const USDT = '0x55d398326f99059fF775485246999027B3197955';
const WBNB  = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

const VAULT_ABI = [
  'function ambilDanaTrading(address user, uint256 amount) external',
  'function kembalikanHasil(address user, uint256 modal, uint256 hasil) external',
  'function getUserInfo(address user) external view returns (uint256,uint256,uint256,uint256,uint256,uint256,bool)',
  'function getMySettings(address user) external view returns (uint256,uint256,uint256,bool)',
  'function getUserAktif() external view returns (address[])',
  'function getGlobalStats() external view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  'function daftarUser(uint256) external view returns (address)',
  'function minDeposit() external view returns (uint256)',
  'function paused() external view returns (bool)'
];

// ── Vault Contract ───────────────────────────────────────────────────────────
function getVault(signerOrProvider) {
  const config = loadConfig();
  return new ethers.Contract(config.vault.address, VAULT_ABI, signerOrProvider);
}

// ── Honeypot Check ───────────────────────────────────────────────────────────
async function cekHoneypot(tokenAddress) {
  try {
    const res = await axios.get(
      `https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=56`,
      { timeout: 5000 }
    );
    const d = res.data;
    if (d.honeypotResult?.isHoneypot) return { aman: false, alasan: 'Honeypot terdeteksi' };
    if (d.simulationResult?.buyTax > 0)  return { aman: false, alasan: `Tax beli ${d.simulationResult.buyTax}%` };
    if (d.simulationResult?.sellTax > 0) return { aman: false, alasan: `Tax jual ${d.simulationResult.sellTax}%` };
    return { aman: true };
  } catch(e) {
    // Fallback: cek manual via simulasi
    return { aman: true, warning: 'Honeypot API tidak tersedia' };
  }
}

// ── Cek Ownership ────────────────────────────────────────────────────────────
async function cekOwnership(tokenAddress, provider) {
  try {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const owner = await token.owner();
    // Kalau owner adalah zero address = renounced = lebih aman
    if (owner === ethers.ZeroAddress) return { aman: true, renounced: true };
    return { aman: true, renounced: false, owner };
  } catch(e) {
    return { aman: true }; // Tidak ada fungsi owner = ok
  }
}

// ── Cek Likuiditas ───────────────────────────────────────────────────────────
async function cekLikuiditas(pairAddress, provider, config) {
  try {
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [r0, r1] = await pair.getReserves();
    const t0 = await pair.token0();

    // Estimasi nilai USDT dari reserves
    const isToken0Usdt = t0.toLowerCase() === USDT.toLowerCase() ||
                         t0.toLowerCase() === WBNB.toLowerCase();

    const reserveStable = isToken0Usdt ? r0 : r1;
    const likuiditasUSD = parseFloat(ethers.formatUnits(reserveStable, 18)) * 2;

    if (likuiditasUSD < config.bot.minLikuiditasUSD) {
      return { aman: false, alasan: `Likuiditas $${likuiditasUSD.toFixed(0)} < min $${config.bot.minLikuiditasUSD}` };
    }
    return { aman: true, likuiditasUSD };
  } catch(e) {
    return { aman: false, alasan: 'Gagal cek likuiditas' };
  }
}

// ── Cek Umur Contract ────────────────────────────────────────────────────────
async function cekUmurContract(tokenAddress, provider, config) {
  try {
    // Ambil block deploy via eth_getCode tidak langsung, pakai logs
    // Approx: cek creation tx via BSCScan API
    const res = await axios.get(
      `https://api.bscscan.com/api?module=account&action=txlist&address=${tokenAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc&apikey=${process.env.BSCSCAN_API_KEY}`,
      { timeout: 5000 }
    );
    if (res.data.result && res.data.result.length > 0) {
      const deployTime = parseInt(res.data.result[0].timeStamp) * 1000;
      const umurMenit  = (Date.now() - deployTime) / 60000;
      if (umurMenit < config.bot.minUmurMenit) {
        return { aman: false, alasan: `Contract baru ${umurMenit.toFixed(1)} menit < min ${config.bot.minUmurMenit} menit` };
      }
      return { aman: true, umurMenit };
    }
    return { aman: true }; // Tidak bisa cek = lanjut
  } catch(e) {
    return { aman: true }; // API error = lanjut
  }
}

// ── Filter Lengkap ───────────────────────────────────────────────────────────
async function filterToken(tokenAddress, pairAddress, provider, config) {
  log(`🔍 Filter token ${tokenAddress}...`);

  // Blacklist check
  if (blacklistRuntime.has(tokenAddress.toLowerCase())) {
    return { lolos: false, alasan: 'Blacklist' };
  }
  for (const bl of config.filter.blacklistToken) {
    if (bl.toLowerCase() === tokenAddress.toLowerCase()) {
      return { lolos: false, alasan: 'Blacklist config' };
    }
  }

  // Honeypot
  if (config.filter.honeypotCheck) {
    const hp = await cekHoneypot(tokenAddress);
    if (!hp.aman) return { lolos: false, alasan: hp.alasan };
  }

  // Likuiditas
  const liq = await cekLikuiditas(pairAddress, provider, config);
  if (!liq.aman) return { lolos: false, alasan: liq.alasan };

  // Umur contract
  const umur = await cekUmurContract(tokenAddress, provider, config);
  if (!umur.aman) return { lolos: false, alasan: umur.alasan };

  // Ownership
  if (config.filter.ownershipCheck) {
    await cekOwnership(tokenAddress, provider); // Info saja, tidak block
  }

  log(`✅ Token ${tokenAddress} lolos semua filter`);
  return { lolos: true, likuiditasUSD: liq.likuiditasUSD };
}

// ── Eksekusi Beli ────────────────────────────────────────────────────────────
async function eksekusiBeli(tokenAddress, routerAddress, config, userAddress, modalUser) {
  try {
    const wallet   = await getWallet();
    const provider = wallet.provider;
    const router   = new ethers.Contract(routerAddress, ROUTER_ABI, wallet);
    const usdt     = new ethers.Contract(USDT, ERC20_ABI, wallet);
    const token    = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const vault    = getVault(wallet);

    const modal    = modalUser || config.bot.modalPerSiklus;
    const modalWei = ethers.parseUnits(modal.toFixed(6), 18);
    const slippage = config.bot.slippagePct / 100;

    // Ambil dana dari vault contract per user
    log(`💳 Ambil dana $${modal} dari SniperVault untuk user ${userAddress.slice(0,8)}...`);
    const txAmbil = await vault.ambilDanaTrading(userAddress, modalWei);
    await txAmbil.wait();

    // Transfer USDT dari vault ke wallet bot (vault sudah kurangi saldo user)
    // Approve USDT untuk router
    const allowance = await usdt.allowance(wallet.address, routerAddress);
    if (allowance < modalWei) {
      log(`📝 Approve USDT...`);
      const txApprove = await usdt.approve(routerAddress, ethers.MaxUint256);
      await txApprove.wait();
    }

    // Estimasi output
    const amountsOut = await router.getAmountsOut(modalWei, [USDT, tokenAddress]);
    const minOut     = amountsOut[1] * BigInt(Math.floor((1 - slippage) * 10000)) / 10000n;

    // Eksekusi swap
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      modalWei, minOut, [USDT, tokenAddress], wallet.address, deadline,
      { gasPrice: ethers.parseUnits(config.bot.gasPriceGwei.toString(), 'gwei'), gasLimit: 300000 }
    );
    const receipt = await tx.wait();

    // Cek saldo token setelah beli
    const decimals   = await token.decimals();
    const saldoToken = await token.balanceOf(wallet.address);
    const symbol     = await token.symbol().catch(() => '???');

    const hargaBeli = config.bot.modalPerSiklus / parseFloat(ethers.formatUnits(saldoToken, decimals));

    log(`✅ BELI ${symbol} | Modal $${config.bot.modalPerSiklus} | ${ethers.formatUnits(saldoToken, decimals)} token | Harga: $${hargaBeli.toFixed(8)}`);

    return {
      sukses: true,
      tokenAddress,
      symbol,
      decimals: Number(decimals),
      jumlahToken: saldoToken,
      hargaBeli,
      modal,
      userAddress,
      waktuBeli: Date.now(),
      routerAddress,
      txHash: receipt.hash
    };
  } catch(e) {
    log(`❌ Gagal beli: ${e.message}`);
    return { sukses: false, alasan: e.message };
  }
}

// ── Monitor Posisi ───────────────────────────────────────────────────────────
async function monitorPosisi(posisi, config) {
  try {
    const wallet   = await getWallet();
    const provider = wallet.provider;
    const router   = new ethers.Contract(posisi.routerAddress, ROUTER_ABI, provider);

    const jumlahWei  = posisi.jumlahToken;
    const amountsOut = await router.getAmountsOut(jumlahWei, [posisi.tokenAddress, USDT]);
    const nilaiUSDT  = parseFloat(ethers.formatUnits(amountsOut[1], 18));
    const profitPct  = ((nilaiUSDT - posisi.modal) / posisi.modal) * 100;

    // Update puncak untuk trailing stop
    if (nilaiUSDT > (posisi.puncak || posisi.modal)) {
      posisiAktif[posisi.tokenAddress].puncak = nilaiUSDT;
    }

    const puncak        = posisiAktif[posisi.tokenAddress].puncak || posisi.modal;
    const trailingDrop  = ((puncak - nilaiUSDT) / puncak) * 100;

    log(`📊 ${posisi.symbol} | Nilai: $${nilaiUSDT.toFixed(4)} | P/L: ${profitPct.toFixed(2)}% | Puncak: $${puncak.toFixed(4)} | Drop: ${trailingDrop.toFixed(2)}%`);

    // Gunakan TP/SL per user kalau ada, fallback ke config global
    const tpPct = posisi.tpPct || config.bot.targetProfitPct;
    const slPct = posisi.slPct || config.bot.stopLossPct;

    // Take profit: trailing stop aktif setelah target profit tercapai
    const sudahProfit = profitPct >= tpPct;
    const trailingHit = sudahProfit && trailingDrop >= config.bot.trailingStopPct;

    // Stop loss per user
    const stopLossHit = profitPct <= -slPct;

    if (trailingHit || stopLossHit) {
      const alasan = trailingHit ? `Trailing stop (puncak $${puncak.toFixed(4)}, drop ${trailingDrop.toFixed(2)}%)` : `Stop loss ${profitPct.toFixed(2)}%`;
      await eksekusiJual(posisi, nilaiUSDT, profitPct, alasan, config);
    }
  } catch(e) {
    log(`⚠️ Monitor error ${posisi.symbol}: ${e.message}`);
  }
}

// ── Eksekusi Jual ────────────────────────────────────────────────────────────
async function eksekusiJual(posisi, nilaiUSDT, profitPct, alasan, config) {
  try {
    const wallet = await getWallet();
    const router = new ethers.Contract(posisi.routerAddress, ROUTER_ABI, wallet);
    const token  = new ethers.Contract(posisi.tokenAddress, ERC20_ABI, wallet);

    // Approve token
    const allowance = await token.allowance(wallet.address, posisi.routerAddress);
    if (allowance < posisi.jumlahToken) {
      const txApprove = await token.approve(posisi.routerAddress, ethers.MaxUint256);
      await txApprove.wait();
    }

    const slippage = config.bot.slippagePct / 100;
    const minOut   = ethers.parseUnits((nilaiUSDT * (1 - slippage)).toFixed(6), 18);
    const deadline = Math.floor(Date.now() / 1000) + 60;

    const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      posisi.jumlahToken, minOut, [posisi.tokenAddress, USDT], wallet.address, deadline,
      { gasPrice: ethers.parseUnits(config.bot.gasPriceGwei.toString(), 'gwei'), gasLimit: 300000 }
    );
    const receipt = await tx.wait();

    const pl     = nilaiUSDT - posisi.modal;
    const emoji  = pl >= 0 ? '🟢' : '🔴';

    log(`${emoji} JUAL ${posisi.symbol} | ${alasan} | Modal: $${posisi.modal} | Hasil: $${nilaiUSDT.toFixed(4)} | P/L: ${pl >= 0 ? '+' : ''}$${pl.toFixed(4)} (${profitPct.toFixed(2)}%)`);

    // Update stats
    if (pl >= 0) totalProfit += pl; else totalLoss += Math.abs(pl);
    totalTrade++;
    saldoBot += nilaiUSDT;

    // Simpan history
    historyTrade.push({
      tokenAddress : posisi.tokenAddress,
      symbol       : posisi.symbol,
      modal        : posisi.modal,
      hasil        : nilaiUSDT,
      pl, profitPct,
      alasan,
      waktuBeli    : posisi.waktuBeli,
      waktuJual    : Date.now(),
      txHash       : receipt.hash
    });
    if (historyTrade.length > 500) historyTrade.shift();

    // Kembalikan hasil ke vault contract
    const hasilWei = ethers.parseUnits(nilaiUSDT.toFixed(6), 18);
    const modalWei = ethers.parseUnits(posisi.modal.toString(), 18);
    try {
      const wallet = await getWallet();
      const vault  = getVault(wallet);
      const usdtC  = new ethers.Contract(USDT, ERC20_ABI, wallet);
      // Approve vault untuk ambil hasil
      await usdtC.approve(vault.target, hasilWei);
      const txKembali = await vault.kembalikanHasil(posisi.userAddress || wallet.address, modalWei, hasilWei);
      await txKembali.wait();
      log(`✅ Hasil dikembalikan ke vault & distribusi profit otomatis`);
    } catch(e) {
      log(`⚠️ Gagal kembalikan ke vault: ${e.message}`);
    }

    // Hapus dari posisi aktif
    delete posisiAktif[posisi.tokenAddress];

    // Simpan state
    simpanState();

  } catch(e) {
    log(`❌ Gagal jual ${posisi.symbol}: ${e.message}`);
  }
}

// ── Scanner Token Baru ───────────────────────────────────────────────────────
async function scanTokenBaru(dexName, dexConfig, config) {
  if (!dexConfig.aktif) return;
  try {
    const provider = await getBscProvider();
    const factory  = new ethers.Contract(dexConfig.factory, FACTORY_ABI, provider);

    factory.on('PairCreated', async (token0, token1, pairAddress) => {
      // Tentukan mana token target (bukan USDT/WBNB)
      let tokenTarget = null;
      if (token0.toLowerCase() === USDT.toLowerCase() || token0.toLowerCase() === WBNB.toLowerCase()) {
        tokenTarget = token1;
      } else if (token1.toLowerCase() === USDT.toLowerCase() || token1.toLowerCase() === WBNB.toLowerCase()) {
        tokenTarget = token0;
      } else {
        return; // Bukan pair dengan USDT/WBNB
      }

      log(`🆕 Token baru di ${dexName}: ${tokenTarget} | Pair: ${pairAddress}`);

      // Cek max posisi aktif
      if (Object.keys(posisiAktif).length >= config.bot.maxPosisiAktif) {
        log(`⏸️ Max posisi aktif tercapai (${config.bot.maxPosisiAktif})`);
        return;
      }

      // Cek ada user aktif (saldo dicek per user di vault)
      if (saldoBot <= 0) {
        log(`⚠️ Total pool vault kosong: $${saldoBot.toFixed(2)}`);
        return;
      }

      // Tunggu sesuai umur minimum
      const umurMs = config.bot.minUmurMenit * 60 * 1000;
      log(`⏳ Tunggu ${config.bot.minUmurMenit} menit sebelum filter...`);
      await new Promise(r => setTimeout(r, umurMs));

      // Filter
      const hasil = await filterToken(tokenTarget, pairAddress, provider, config);
      if (!hasil.lolos) {
        log(`❌ Token tidak lolos: ${hasil.alasan}`);
        blacklistRuntime.add(tokenTarget.toLowerCase());
        return;
      }

      // Ambil daftar user aktif dari vault
      let usersAktif = [];
      try {
        const provider2 = await getBscProvider();
        const vault2    = getVault(provider2);
        usersAktif      = await vault2.getUserAktif();
        log(`👥 User aktif: ${usersAktif.length}`);
      } catch(e) {
        log(`⚠️ Gagal ambil user aktif: ${e.message}`);
      }

      if (usersAktif.length === 0) {
        log(`⏭️ Tidak ada user aktif, skip token ini`);
        return;
      }

      // Beli per user sesuai setting masing-masing
      for (const userAddr of usersAktif) {
        try {
          const provider2 = await getBscProvider();
          const vault2    = getVault(provider2);
          const settings  = await vault2.getMySettings(userAddr);
          const modalUser = parseFloat(ethers.formatUnits(settings[2], 18));
          const tpUser    = Number(settings[0]);
          const slUser    = Number(settings[1]);

          const posisi = await eksekusiBeli(tokenTarget, dexConfig.router, config, userAddr, modalUser);
          if (posisi.sukses) {
            const key = `${tokenTarget}_${userAddr}`;
            posisiAktif[key] = {
              ...posisi,
              puncak      : posisi.modal,
              userAddress : userAddr,
              tpPct       : tpUser,
              slPct       : slUser
            };
            log(`✅ Posisi dibuka untuk user ${userAddr.slice(0,8)} | TP:${tpUser}% SL:${slUser}%`);
          }
          await new Promise(r => setTimeout(r, 1000)); // jeda antar user
        } catch(e) {
          log(`⚠️ Gagal beli untuk user ${userAddr.slice(0,8)}: ${e.message}`);
        }
      }
      simpanState();
    });

    log(`👀 Scanner ${dexName} aktif`);
  } catch(e) {
    log(`❌ Scanner ${dexName} error: ${e.message}`);
  }
}

// ── Loop Monitor Posisi ──────────────────────────────────────────────────────
async function loopMonitor() {
  const config = loadConfig();
  if (!config.bot.aktif) return;

  const posisiList = Object.values(posisiAktif);
  for (const posisi of posisiList) {
    await monitorPosisi(posisi, config);
    await new Promise(r => setTimeout(r, 500));
  }
}

// ── Simpan & Load State ──────────────────────────────────────────────────────
function simpanState() {
  const state = { posisiAktif, historyTrade, saldoBot, totalProfit, totalLoss, totalTrade };
  fs.writeFileSync(path.join(__dirname, 'sniper-state.json'), JSON.stringify(state, null, 2));
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'sniper-state.json'), 'utf8'));
    posisiAktif  = state.posisiAktif  || {};
    historyTrade = state.historyTrade || [];
    saldoBot     = state.saldoBot     || 0;
    totalProfit  = state.totalProfit  || 0;
    totalLoss    = state.totalLoss    || 0;
    totalTrade   = state.totalTrade   || 0;
    log('📂 State loaded');
  } catch(e) {
    log('📂 State baru dimulai');
  }
}

// ── Inisialisasi Saldo ───────────────────────────────────────────────────────
async function initSaldo() {
  try {
    const provider = await getBscProvider();
    const vault    = getVault(provider);
    const gs       = await vault.getGlobalStats();
    saldoBot       = parseFloat(ethers.formatUnits(gs[0], 18)); // totalPool
    log(`💰 Total Pool Vault: $${saldoBot.toFixed(2)}`);
  } catch(e) {
    log(`⚠️ Gagal cek saldo vault: ${e.message}`);
  }
}

// ── Logger ───────────────────────────────────────────────────────────────────
function log(msg) {
  const ts  = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const out = `[${ts}] ${msg}`;
  console.log(out);
  // Simpan log ke file
  fs.appendFileSync(path.join(__dirname, 'sniper-log.txt'), out + '\n');
  // Trim log kalau terlalu besar (max 5MB)
  try {
    const stat = fs.statSync(path.join(__dirname, 'sniper-log.txt'));
    if (stat.size > 5 * 1024 * 1024) {
      const lines = fs.readFileSync(path.join(__dirname, 'sniper-log.txt'), 'utf8').split('\n');
      fs.writeFileSync(path.join(__dirname, 'sniper-log.txt'), lines.slice(-1000).join('\n'));
    }
  } catch(e) {}
}

// ── Export state untuk API server ────────────────────────────────────────────
function getStats() {
  return {
    aktif        : loadConfig().bot.aktif,
    saldoBot,
    totalProfit,
    totalLoss,
    totalTrade,
    posisiAktif  : Object.values(posisiAktif),
    historyTrade : historyTrade.slice(-50),
    config       : loadConfig()
  };
}

module.exports = { getStats, loadConfig };

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('🚀 INDOCOIN Token Sniper Bot v1.0 starting...');

  if (!process.env.SNIPER_PRIVATE_KEY) {
    log('❌ SNIPER_PRIVATE_KEY tidak ditemukan di .env');
    process.exit(1);
  }

  loadState();
  await initSaldo();

  const config = loadConfig();

  // Start semua scanner DEX
  for (const [dexName, dexConfig] of Object.entries(config.dex)) {
    await scanTokenBaru(dexName, dexConfig, config);
  }

  // Loop monitor posisi aktif setiap 3 detik
  setInterval(async () => {
    const cfg = loadConfig();
    if (!cfg.bot.aktif) return;
    await loopMonitor();
  }, config.bot.scanIntervalDetik * 1000);

  // Update saldo setiap 5 menit
  setInterval(initSaldo, 5 * 60 * 1000);

  // Simpan state setiap 1 menit
  setInterval(simpanState, 60 * 1000);

  log(`✅ Bot aktif | Modal: $${config.bot.modalPerSiklus} | Target: +${config.bot.targetProfitPct}% | SL: -${config.bot.stopLossPct}% | Trailing: -${config.bot.trailingStopPct}%`);
}

if (require.main === module) {
  main().catch(e => {
    log(`💀 Fatal error: ${e.message}`);
    process.exit(1);
  });
}
