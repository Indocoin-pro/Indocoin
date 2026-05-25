/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         ARBIBOT TRADE — DEX PRICE SCANNER               ║
 * ║         by INDOCOIN                                      ║
 * ║                                                          ║
 * ║  Scan harga di PancakeSwap V2, V3, BiSwap               ║
 * ║  Deteksi peluang arbitrage > 0.5%                       ║
 * ║  Eksekusi via smart contract                            ║
 * ║  Laporkan hasil ke contract (distributeProfit/reportLoss)║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Install: npm install ethers node-cron axios
 * Jalankan: node arbibot-scanner.js
 * PM2: pm2 start arbibot-scanner.js --name arbibot
 */

'use strict';

const { ethers } = require('ethers');
const cron       = require('node-cron');
const axios      = require('axios');

// ── CONFIG ───────────────────────────────────────────────
const CONFIG = {
  RPC_URL       : 'https://bsc-dataseed1.binance.org/',
  RPC_BACKUP    : 'https://bsc-dataseed2.binance.org/',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',
  CONTRACT_ADDR : '0x4C37CAD6909305274373803b88f4D2ab5162f259',

  // Token addresses BSC
  TOKENS: {
    USDT  : '0x55d398326f99059fF775485246999027B3197955',
    BNB   : '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    INDC  : '0xD772c96e1beFd2ea9C9a83182c71f4d32f306571',
    CAKE  : '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    BTCB  : '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', // Bridged BTC
    ETH   : '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // Bridged ETH
    XRP   : '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE',
    ADA   : '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47',
    DOT   : '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402',
    LINK  : '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD',
    MATIC : '0xCC42724C6683B7E57334c4E856f4c9965ED682bD',
  },

  // DEX Router addresses
  ROUTERS: {
    PANCAKE_V2 : '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    PANCAKE_V3 : '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
    BISWAP     : '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
  },

  // Pasangan token yang di-scan — 20 pasangan
  PAIRS: [
    // USDT/ 10 pasangan
    { tokenIn: 'USDT', tokenOut: 'BNB',   amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'BTCB',  amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'ETH',   amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'CAKE',  amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'XRP',   amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'ADA',   amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'DOT',   amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'LINK',  amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'MATIC', amountIn: '100' },
    { tokenIn: 'USDT', tokenOut: 'INDC',  amountIn: '50'  },
    // BNB/ 10 pasangan
    { tokenIn: 'BNB',  tokenOut: 'BTCB',  amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'ETH',   amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'CAKE',  amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'XRP',   amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'ADA',   amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'DOT',   amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'LINK',  amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'MATIC', amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'USDT',  amountIn: '0.1' },
    { tokenIn: 'BNB',  tokenOut: 'INDC',  amountIn: '0.1' },
  ],

  // Thresholds
  MIN_PROFIT_PCT  : 0.005,   // 0.5% minimum profit
  GAS_BUFFER_USD  : 0.3,     // $0.30 buffer untuk gas fee
  SCAN_INTERVAL   : 30,      // 30 detik antar scan
  MAX_TRADE_USD   : 2000,    // $2.000 maks per eksekusi
  COOLDOWN_MS     : 35000,   // 35 detik cooldown (lebih dari contract 30s)
};

// ── ABIs ─────────────────────────────────────────────────
const ROUTER_V2_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external',
];

const ROUTER_V3_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
];

const CONTRACT_ABI = [
  'function distributeProfit(address user, uint256 grossProfit) external',
  'function reportLoss(uint256 lossAmt) external',
  'function getPublicStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
  'function paused() view returns (bool)',
  'function statActiveUsers() view returns (uint256)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ── STATE ─────────────────────────────────────────────────
let provider, signer, contract;
let lastExecTime   = 0;
let totalScans     = 0;
let totalArbi      = 0;
let totalProfit    = 0;
let isRunning      = false;

// ── INIT ──────────────────────────────────────────────────
async function init() {
  console.log('🤖 ArbiBot Trade Scanner starting...');

  // Provider dengan fallback
  try {
    provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
    await provider.getBlockNumber();
    console.log('✅ Connected to BSC via primary RPC');
  } catch(e) {
    console.log('⚠️  Primary RPC failed, trying backup...');
    provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_BACKUP);
  }

  signer   = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  contract = new ethers.Contract(CONFIG.CONTRACT_ADDR, CONTRACT_ABI, signer);

  console.log('🔑 Bot wallet:', signer.address);
  console.log('📋 Contract:', CONFIG.CONTRACT_ADDR);

  // Cek BNB balance untuk gas
  const bnbBal = await provider.getBalance(signer.address);
  console.log('⛽ BNB balance:', ethers.utils.formatEther(bnbBal), 'BNB');

  if (bnbBal.lt(ethers.utils.parseEther('0.01'))) {
    console.warn('⚠️  BNB rendah! Isi BNB untuk gas fee.');
  }

  await startScanner();
}

// ── SCANNER UTAMA ─────────────────────────────────────────
async function startScanner() {
  console.log(`\n🔄 Scanner aktif — interval ${CONFIG.SCAN_INTERVAL}s`);

  // Jalankan pertama kali
  await scanAndExecute();

  // Jadwalkan interval
  setInterval(async () => {
    if (!isRunning) await scanAndExecute();
  }, CONFIG.SCAN_INTERVAL * 1000);
}

async function scanAndExecute() {
  isRunning = true;
  totalScans++;

  try {
    // Cek apakah contract paused
    const isPaused = await contract.paused().catch(() => false);
    if (isPaused) {
      console.log('⏸️  Contract paused — skip scan');
      isRunning = false;
      return;
    }

    // Cek cooldown
    const now = Date.now();
    if (now - lastExecTime < CONFIG.COOLDOWN_MS) {
      console.log(`⏳ Cooldown... ${Math.round((CONFIG.COOLDOWN_MS - (now - lastExecTime))/1000)}s lagi`);
      isRunning = false;
      return;
    }

    console.log(`\n[${new Date().toLocaleTimeString('id-ID')}] Scan #${totalScans}`);

    // Scan semua pair di semua DEX
    const opportunities = await findArbitrageOpportunities();

    if (opportunities.length === 0) {
      console.log('  → Tidak ada peluang arbitrage saat ini');
      isRunning = false;
      return;
    }

    // Ambil peluang terbaik
    const best = opportunities[0];
    console.log(`\n💡 PELUANG DITEMUKAN!`);
    console.log(`   Pair  : ${best.tokenIn} → ${best.tokenOut}`);
    console.log(`   Beli di: ${best.buyDex}`);
    console.log(`   Jual di: ${best.sellDex}`);
    console.log(`   Profit : ${(best.profitPct * 100).toFixed(3)}%`);
    console.log(`   Est. $  : $${best.estimatedProfitUSD.toFixed(4)}`);

    // Eksekusi
    await executeArbitrage(best);

  } catch(e) {
    console.error('❌ Scanner error:', e.message);
    // Laporkan loss kecil untuk circuit breaker
    try {
      await contract.reportLoss(ethers.utils.parseUnits('1', 18));
    } catch(re) {}
  }

  isRunning = false;
}

// ── CARI PELUANG ──────────────────────────────────────────
async function findArbitrageOpportunities() {
  const opportunities = [];

  for (const pair of CONFIG.PAIRS) {
    const tokenInAddr  = CONFIG.TOKENS[pair.tokenIn];
    const tokenOutAddr = CONFIG.TOKENS[pair.tokenOut];
    const decimalsIn   = pair.tokenIn === 'BNB' ? 18 : 18;
    const amountIn     = ethers.utils.parseUnits(pair.amountIn, decimalsIn);

    // Ambil harga di semua DEX
    const prices = await getAllDexPrices(tokenInAddr, tokenOutAddr, amountIn);

    // Cari kombinasi beli murah jual mahal
    const dexNames = Object.keys(prices);
    for (let i = 0; i < dexNames.length; i++) {
      for (let j = 0; j < dexNames.length; j++) {
        if (i === j) continue;

        const buyDex  = dexNames[i];
        const sellDex = dexNames[j];
        const buyAmt  = prices[buyDex];  // dapat tokenOut jika beli
        const sellAmt = prices[sellDex]; // dapat tokenIn jika jual balik

        if (!buyAmt || !sellAmt) continue;

        // Hitung profit sederhana
        // Beli tokenOut dengan tokenIn → jual tokenOut dapat tokenIn kembali
        const sellBack = await getDexPrice(
          sellDex, tokenOutAddr, tokenInAddr, buyAmt
        );
        if (!sellBack) continue;

        const profitRaw = sellBack.sub(amountIn);
        if (profitRaw.lte(0)) continue;

        const profitPct = profitRaw.mul(10000).div(amountIn).toNumber() / 10000;

        if (profitPct >= CONFIG.MIN_PROFIT_PCT) {
          const estimatedProfitUSD = await toUSD(pair.tokenIn, profitRaw, decimalsIn);

          // Kurangi gas buffer
          if (estimatedProfitUSD > CONFIG.GAS_BUFFER_USD) {
            opportunities.push({
              tokenIn         : pair.tokenIn,
              tokenOut        : pair.tokenOut,
              tokenInAddr,
              tokenOutAddr,
              amountIn,
              buyDex,
              sellDex,
              profitPct,
              estimatedProfitUSD: estimatedProfitUSD - CONFIG.GAS_BUFFER_USD,
              profitRaw,
            });
          }
        }
      }
    }
  }

  // Sort by profit terbesar
  return opportunities.sort((a, b) => b.estimatedProfitUSD - a.estimatedProfitUSD);
}

// ── AMBIL HARGA DI SEMUA DEX ──────────────────────────────
async function getAllDexPrices(tokenIn, tokenOut, amountIn) {
  const results = {};

  await Promise.all([
    getDexPrice('PANCAKE_V2', tokenIn, tokenOut, amountIn)
      .then(v => { if (v) results['PANCAKE_V2'] = v; }),
    getDexPrice('BISWAP', tokenIn, tokenOut, amountIn)
      .then(v => { if (v) results['BISWAP'] = v; }),
  ]);

  return results;
}

async function getDexPrice(dex, tokenIn, tokenOut, amountIn) {
  try {
    if (dex === 'PANCAKE_V2' || dex === 'BISWAP') {
      const routerAddr = CONFIG.ROUTERS[dex];
      const router = new ethers.Contract(routerAddr, ROUTER_V2_ABI, provider);
      const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      return amounts[amounts.length - 1];
    }
    return null;
  } catch(e) {
    return null;
  }
}

// ── EKSEKUSI ARBITRAGE ────────────────────────────────────
async function executeArbitrage(opp) {
  console.log('\n⚡ EKSEKUSI ARBITRAGE...');

  try {
    // Pastikan tidak melebihi max trade
    const amountUSD = await toUSD(opp.tokenIn, opp.amountIn, 18);
    if (amountUSD > CONFIG.MAX_TRADE_USD) {
      console.log(`  Jumlah $${amountUSD} melebihi maks $${CONFIG.MAX_TRADE_USD} — skip`);
      return;
    }

    // Approve token jika perlu
    await ensureApproval(opp.tokenInAddr, CONFIG.ROUTERS[opp.buyDex], opp.amountIn);

    // Step 1: Beli tokenOut dengan tokenIn di buyDex
    const buyRouter   = new ethers.Contract(CONFIG.ROUTERS[opp.buyDex], ROUTER_V2_ABI, signer);
    const minOut      = opp.amountIn; // hitung dari harga — simplified
    const deadline    = Math.floor(Date.now() / 1000) + 120; // 2 menit

    console.log(`  Step 1: Beli ${opp.tokenOut} di ${opp.buyDex}...`);
    const buyTx = await buyRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      opp.amountIn,
      0, // amountOutMin = 0 untuk simplicity (production: hitung slippage)
      [opp.tokenInAddr, opp.tokenOutAddr],
      signer.address,
      deadline,
      { gasLimit: 300000 }
    );
    const buyReceipt = await buyTx.wait();
    console.log(`  ✅ Beli sukses! TX: ${buyReceipt.transactionHash.slice(0,16)}...`);

    // Cek tokenOut yang didapat
    const tokenOutContract = new ethers.Contract(opp.tokenOutAddr, ERC20_ABI, provider);
    const tokenOutBal      = await tokenOutContract.balanceOf(signer.address);

    // Step 2: Jual tokenOut di sellDex
    await ensureApproval(opp.tokenOutAddr, CONFIG.ROUTERS[opp.sellDex], tokenOutBal);

    const sellRouter = new ethers.Contract(CONFIG.ROUTERS[opp.sellDex], ROUTER_V2_ABI, signer);

    console.log(`  Step 2: Jual ${opp.tokenOut} di ${opp.sellDex}...`);
    const sellTx = await sellRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      tokenOutBal,
      opp.amountIn, // minimal dapat kembali modal
      [opp.tokenOutAddr, opp.tokenInAddr],
      signer.address,
      deadline,
      { gasLimit: 300000 }
    );
    const sellReceipt = await sellTx.wait();
    console.log(`  ✅ Jual sukses! TX: ${sellReceipt.transactionHash.slice(0,16)}...`);

    // Hitung profit aktual
    const tokenInContract = new ethers.Contract(opp.tokenInAddr, ERC20_ABI, provider);
    const tokenInBal      = await tokenInContract.balanceOf(signer.address);
    const actualProfit    = tokenInBal.gt(opp.amountIn)
      ? tokenInBal.sub(opp.amountIn)
      : ethers.BigNumber.from(0);

    if (actualProfit.gt(0)) {
      const profitUSD = await toUSD(opp.tokenIn, actualProfit, 18);
      console.log(`\n🎉 PROFIT: $${profitUSD.toFixed(4)}`);

      totalArbi++;
      totalProfit += profitUSD;
      lastExecTime = Date.now();

      // Laporkan profit ke contract (untuk distribusi ke user)
      // Dalam production: konversi profit ke USDT dulu sebelum distribute
      console.log(`  Distribusi profit ke contract...`);
      // NOTE: distributeProfit perlu user address
      // Dalam production: bot track user mana yang depositnya paling besar
      // Untuk sekarang: log saja
      console.log(`  ℹ️  Profit $${profitUSD.toFixed(4)} siap didistribusikan`);

    } else {
      console.log('  ⚠️  Profit tidak sesuai ekspektasi — mungkin slippage');
      await contract.reportLoss(ethers.utils.parseUnits('1', 18));
    }

  } catch(e) {
    console.error('  ❌ Eksekusi gagal:', e.message);
    try {
      await contract.reportLoss(ethers.utils.parseUnits('5', 18));
    } catch(re) {}
  }
}

// ── HELPERS ───────────────────────────────────────────────

// Approve token untuk router
async function ensureApproval(tokenAddr, spender, amount) {
  const token     = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const allowance = await token.allowance(signer.address, spender);
  if (allowance.lt(amount)) {
    console.log(`  Approve token...`);
    const tx = await token.approve(spender, ethers.constants.MaxUint256);
    await tx.wait();
    console.log(`  ✅ Approved`);
  }
}

// Konversi amount ke USD (simplified)
async function toUSD(symbol, amount, decimals) {
  try {
    // Ambil harga dari Binance API
    if (symbol === 'USDT' || symbol === 'BUSD') {
      return parseFloat(ethers.utils.formatUnits(amount, decimals));
    }
    const res   = await axios.get(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
      { timeout: 3000 }
    );
    const price = parseFloat(res.data.price);
    const amt   = parseFloat(ethers.utils.formatUnits(amount, decimals));
    return amt * price;
  } catch(e) {
    return 0;
  }
}

// ── STATUS REPORT ──────────────────────────────────────────
// Setiap 5 menit print status
setInterval(() => {
  console.log(`\n📊 STATUS REPORT [${new Date().toLocaleTimeString('id-ID')}]`);
  console.log(`   Total scans  : ${totalScans}`);
  console.log(`   Total arbi   : ${totalArbi}`);
  console.log(`   Total profit : $${totalProfit.toFixed(4)}`);
  console.log(`   Win rate     : ${totalScans > 0 ? ((totalArbi/totalScans)*100).toFixed(1) : 0}%`);
}, 5 * 60 * 1000);

// ── START ─────────────────────────────────────────────────
init().catch(e => {
  console.error('❌ Fatal error:', e.message);
  process.exit(1);
});

module.exports = { findArbitrageOpportunities, executeArbitrage };
