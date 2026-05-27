require("dotenv").config();
const { ethers } = require('ethers');

// ─────────────────────────────────────────────────────────
//  DODO PMM ARBITRAGE BOT — INDOCOIN
//  Cari selisih harga DODO (PMM) vs PancakeSwap V2 (AMM)
//  DODO pakai oracle Chainlink + inventory imbalance
//  AMM pakai x*y=k → math BEDA → sering ada gap
// ─────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL       : 'https://bsc.publicnode.com',
  RPC_BACKUP    : 'https://binance.llamarpc.com',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',

  ARBIBOT_TRADE : '0x4C37CAD6909305274373803b88f4D2ab5162f259',

  // PancakeSwap V2
  PANCAKE_V2_ROUTER : '0x10ED43C718714eb63d5aA57B78B54704E256024E',

  // DODO V2 Pools BSC
  // Setiap pool: address pool, base & quote token
  DODO_POOLS: [
    {
      name    : 'WBNB-USDT',
      address : '0x5b206ee7738c3F1Cd13779B6FE2bC4BdC8d56dC0',
      base    : '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      quote   : '0x55d398326f99059fF775485246999027B3197955', // USDT
    },
    {
      name    : 'BTCB-USDT',
      address : '0x395E0625fAcD80aEea1Fbf03e1D81e859169e7C2',
      base    : '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', // BTCB
      quote   : '0x55d398326f99059fF775485246999027B3197955', // USDT
    },
    {
      name    : 'ETH-USDT',
      address : '0xA9b59Ec84cFFEC9D32390D24a55e0e9F03bA2BA0',
      base    : '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // ETH
      quote   : '0x55d398326f99059fF775485246999027B3197955', // USDT
    },
  ],

  AMOUNT_IN_USDT   : '500',     // jumlah pinjam per percobaan
  MIN_PROFIT_USD   : 1.0,        // minimal $1 profit
  MIN_PROFIT_PCT   : 0.008,      // min 0.8%
  MAX_PROFIT_PCT   : 0.05,       // > 5% = halusinasi
  SCAN_INTERVAL    : 12,         // detik
  EXECUTE_MODE     : false,
};

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint256, address[]) view returns (uint256[])',
];

// DODO V2 Pool ABI (DVM/DSP)
const DODO_POOL_ABI = [
  'function querySellBase(address trader, uint256 payBaseAmount) external view returns (uint256 receiveQuoteAmount, uint256 mtFee)',
  'function querySellQuote(address trader, uint256 payQuoteAmount) external view returns (uint256 receiveBaseAmount, uint256 mtFee)',
  'function _BASE_TOKEN_() external view returns (address)',
  'function _QUOTE_TOKEN_() external view returns (address)',
];

let provider, signer, v2Router;
let scanCount = 0;

async function init() {
  console.log('🦤 DODO PMM Arbitrage Bot — INDOCOIN');
  console.log('═'.repeat(50));

  const rpcs = [CONFIG.RPC_URL, CONFIG.RPC_BACKUP];
  for (const rpc of rpcs) {
    try {
      provider = new ethers.providers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      console.log(`✅ Connected: ${rpc}`);
      break;
    } catch(e) {}
  }

  signer = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  v2Router = new ethers.Contract(CONFIG.PANCAKE_V2_ROUTER, V2_ROUTER_ABI, provider);

  console.log('🔑 Bot wallet:', signer.address);
  console.log('💰 Profit ke:', CONFIG.ARBIBOT_TRADE);
  console.log('🦤 DODO pools:', CONFIG.DODO_POOLS.length);
  console.log('🎯 Mode:', CONFIG.EXECUTE_MODE ? '🔴 LIVE' : '🟢 SIMULASI');

  const bnb = await provider.getBalance(signer.address);
  console.log(`⛽ BNB: ${parseFloat(ethers.utils.formatEther(bnb)).toFixed(6)}\n`);

  // Verifikasi setiap pool DODO valid
  for (const pool of CONFIG.DODO_POOLS) {
    try {
      const dodoPool = new ethers.Contract(pool.address, DODO_POOL_ABI, provider);
      const baseAddr = await dodoPool._BASE_TOKEN_();
      console.log(`   ✓ ${pool.name}: base = ${baseAddr.slice(0,10)}...`);
    } catch(e) {
      console.warn(`   ⚠️  ${pool.name}: pool tidak valid - ${e.message.slice(0,40)}`);
    }
  }
  console.log('');
}

async function getV2PriceQuoteToBase(quoteAddr, baseAddr, amountQuoteIn) {
  // Beli base dengan quote: USDT → BNB
  try {
    const result = await v2Router.getAmountsOut(amountQuoteIn, [quoteAddr, baseAddr]);
    return result[1];
  } catch(e) { return null; }
}

async function getV2PriceBaseToQuote(baseAddr, quoteAddr, amountBaseIn) {
  // Jual base ke quote: BNB → USDT
  try {
    const result = await v2Router.getAmountsOut(amountBaseIn, [baseAddr, quoteAddr]);
    return result[1];
  } catch(e) { return null; }
}

async function getDodoPriceQuoteToBase(pool, amountQuoteIn) {
  // Beli base dari quote di DODO: USDT → BNB
  try {
    const dodoPool = new ethers.Contract(pool.address, DODO_POOL_ABI, provider);
    const result = await dodoPool.querySellQuote(signer.address, amountQuoteIn);
    return result.receiveBaseAmount;
  } catch(e) { return null; }
}

async function getDodoPriceBaseToQuote(pool, amountBaseIn) {
  // Jual base ke quote di DODO: BNB → USDT
  try {
    const dodoPool = new ethers.Contract(pool.address, DODO_POOL_ABI, provider);
    const result = await dodoPool.querySellBase(signer.address, amountBaseIn);
    return result.receiveQuoteAmount;
  } catch(e) { return null; }
}

async function findOpportunities() {
  const opps = [];
  const amountIn = ethers.utils.parseUnits(CONFIG.AMOUNT_IN_USDT, 18);

  for (const pool of CONFIG.DODO_POOLS) {
    // ARAH 1: Beli base di V2, jual di DODO
    // USDT → base (V2) → quote (DODO) → USDT
    const baseFromV2 = await getV2PriceQuoteToBase(pool.quote, pool.base, amountIn);
    if (!baseFromV2) continue;
    
    const usdtFromDodo = await getDodoPriceBaseToQuote(pool, baseFromV2);
    if (!usdtFromDodo) continue;

    // ARAH 2: Beli base di DODO, jual di V2
    // USDT → base (DODO) → quote (V2) → USDT
    const baseFromDodo = await getDodoPriceQuoteToBase(pool, amountIn);
    if (!baseFromDodo) continue;
    
    const usdtFromV2 = await getV2PriceBaseToQuote(pool.base, pool.quote, baseFromDodo);
    if (!usdtFromV2) continue;

    // Hitung profit kedua arah
    const route1Out = parseFloat(ethers.utils.formatUnits(usdtFromDodo, 18));
    const route2Out = parseFloat(ethers.utils.formatUnits(usdtFromV2, 18));
    const inputAmt = parseFloat(CONFIG.AMOUNT_IN_USDT);

    const route1Profit = route1Out - inputAmt;
    const route2Profit = route2Out - inputAmt;

    let bestRoute, bestProfit;
    if (route1Profit > route2Profit) {
      bestRoute  = 'V2 → DODO';
      bestProfit = route1Profit;
    } else {
      bestRoute  = 'DODO → V2';
      bestProfit = route2Profit;
    }

    const profitPct = bestProfit / inputAmt;

    if (profitPct < CONFIG.MIN_PROFIT_PCT) continue;
    if (profitPct > CONFIG.MAX_PROFIT_PCT) continue;
    if (bestProfit < CONFIG.MIN_PROFIT_USD) continue;

    opps.push({
      pair: pool.name,
      route: bestRoute,
      profitUSD: bestProfit,
      profitPct,
      route1Profit, route2Profit,
    });
  }

  return opps.sort((a,b) => b.profitUSD - a.profitUSD);
}

async function executeOpp(opp) {
  console.log('\n⚡ DODO ARBITRAGE OPPORTUNITY');
  console.log(`   Pasangan  : ${opp.pair}`);
  console.log(`   Route     : ${opp.route}`);
  console.log(`   Est Profit: $${opp.profitUSD.toFixed(4)} (${(opp.profitPct*100).toFixed(4)}%)`);

  if (!CONFIG.EXECUTE_MODE) {
    console.log('   📝 SIMULASI (perlu deploy DodoFlashArbitrage.sol untuk eksekusi)');
    return;
  }
  
  console.log('   ⚠️  Eksekusi LIVE belum aktif - tunggu deploy contract');
}

async function scan() {
  scanCount++;
  const now = new Date();
  const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

  try {
    const opps = await findOpportunities();

    if (opps.length === 0) {
      console.log(`[${ts}] Scan #${scanCount} — Tidak ada selisih DODO vs V2`);
    } else {
      console.log(`[${ts}] Scan #${scanCount} — ✨ ${opps.length} peluang DODO!`);
      for (const opp of opps.slice(0, 3)) {
        console.log(`   → ${opp.pair} [${opp.route}]: $${opp.profitUSD.toFixed(4)} (${(opp.profitPct*100).toFixed(4)}%)`);
      }
      await executeOpp(opps[0]);
    }

  } catch(e) {
    console.error('Scanner error:', e.message);
  }
}

async function start() {
  console.log(`🔄 Scanner aktif — interval ${CONFIG.SCAN_INTERVAL}s\n`);
  await scan();
  setInterval(scan, CONFIG.SCAN_INTERVAL * 1000);
}

init()
  .then(start)
  .catch(e => { console.error('Fatal:', e.message); process.exit(1); });
