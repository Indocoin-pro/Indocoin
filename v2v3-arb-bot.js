require("dotenv").config();
const { ethers } = require('ethers');

// ─────────────────────────────────────────────────────────
//  PANCAKESWAP V2 vs V3 ARBITRAGE BOT — INDOCOIN
//  Cari selisih harga antara PancakeSwap V2 dan V3
//  V2 = AMM tradisional (x*y=k)
//  V3 = Concentrated liquidity (lebih efisien)
//  Sering ada selisih harga karena likuiditas berbeda
// ─────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL       : 'https://bsc.publicnode.com',
  RPC_BACKUP    : 'https://binance.llamarpc.com',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',

  ARBIBOT_TRADE : '0x4C37CAD6909305274373803b88f4D2ab5162f259',

  // PancakeSwap V2
  PANCAKE_V2_ROUTER : '0x10ED43C718714eb63d5aA57B78B54704E256024E',

  // PancakeSwap V3
  PANCAKE_V3_QUOTER : '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
  PANCAKE_V3_ROUTER : '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',

  TOKENS: {
    USDT  : { addr: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    WBNB  : { addr: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
    BTCB  : { addr: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
    ETH   : { addr: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18 },
    CAKE  : { addr: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18 },
    BUSD  : { addr: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
  },

  // Pasangan yang discan
  PAIRS: [
    { from: 'USDT', to: 'WBNB' },
    { from: 'USDT', to: 'BTCB' },
    { from: 'USDT', to: 'ETH'  },
    { from: 'USDT', to: 'CAKE' },
    { from: 'USDT', to: 'BUSD' },
  ],

  // V3 Fee tiers (basis points: 100=0.01%, 500=0.05%, 2500=0.25%, 10000=1%)
  V3_FEE_TIERS: [100, 500, 2500, 10000],

  AMOUNT_IN_USDT   : '500',     // jumlah pinjam per percobaan
  MIN_PROFIT_USD   : 1.0,        // minimal $1 profit
  MIN_PROFIT_PCT   : 0.008,      // min 0.8% (cover fee swap V2 0.25% + V3 + flash + slippage)
  MAX_PROFIT_PCT   : 0.05,       // > 5% = palsu/halusinasi
  SCAN_INTERVAL    : 15,         // detik
  EXECUTE_MODE     : false,      // false = simulasi (cek peluang dulu)
};

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint256, address[]) view returns (uint256[])',
];

const V3_QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

let provider, signer, v2Router, v3Quoter, arbibotTrade;
let scanCount = 0, lastExecTime = 0, totalExec = 0;

async function init() {
  console.log('🔀 PancakeSwap V2 vs V3 Arbitrage Bot — INDOCOIN');
  console.log('═'.repeat(55));

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
  v3Quoter = new ethers.Contract(CONFIG.PANCAKE_V3_QUOTER, V3_QUOTER_ABI, provider);

  console.log('🔑 Bot wallet:', signer.address);
  console.log('💰 Profit ke:', CONFIG.ARBIBOT_TRADE);
  console.log('🥞 V2 Router:', CONFIG.PANCAKE_V2_ROUTER);
  console.log('🔀 V3 Quoter:', CONFIG.PANCAKE_V3_QUOTER);
  console.log('🎯 Mode:', CONFIG.EXECUTE_MODE ? '🔴 LIVE' : '🟢 SIMULASI');

  const bnb = await provider.getBalance(signer.address);
  console.log(`⛽ BNB: ${parseFloat(ethers.utils.formatEther(bnb)).toFixed(6)}\n`);
}

async function getV2Price(tokenIn, tokenOut, amountIn) {
  try {
    const result = await v2Router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
    return result[1];
  } catch(e) { return null; }
}

async function getV3Price(tokenIn, tokenOut, amountIn, fee) {
  try {
    const result = await v3Quoter.callStatic.quoteExactInputSingle({
      tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0
    });
    return { out: result.amountOut, fee };
  } catch(e) { return null; }
}

async function findOpportunities() {
  const opps = [];
  const amountIn = ethers.utils.parseUnits(CONFIG.AMOUNT_IN_USDT, 18);

  for (const pair of CONFIG.PAIRS) {
    const tokenInAddr  = CONFIG.TOKENS[pair.from].addr;
    const tokenOutAddr = CONFIG.TOKENS[pair.to].addr;

    // Cek harga di V2
    const v2Out = await getV2Price(tokenInAddr, tokenOutAddr, amountIn);
    if (!v2Out) continue;

    // Cek harga di V3 untuk setiap fee tier
    const v3Results = await Promise.all(
      CONFIG.V3_FEE_TIERS.map(fee => getV3Price(tokenInAddr, tokenOutAddr, amountIn, fee))
    );
    
    const validV3 = v3Results.filter(r => r !== null);
    if (validV3.length === 0) continue;

    // Cari V3 dengan output terbaik
    const bestV3 = validV3.reduce((a, b) => 
      a.out.gt(b.out) ? a : b
    );

    const v2OutNum = parseFloat(ethers.utils.formatUnits(v2Out, 18));
    const v3OutNum = parseFloat(ethers.utils.formatUnits(bestV3.out, 18));

    // Tentukan arah arbitrage
    let buyVersion, sellVersion, buyOut, sellOut;
    if (v2OutNum > v3OutNum) {
      // V2 kasih output lebih banyak (V2 lebih murah beli tokenOut)
      // Logic: beli tokenOut di V2 (lebih banyak dapat), jual di V3
      buyVersion  = 'V2';
      sellVersion = `V3 (fee ${bestV3.fee/10000}%)`;
      buyOut      = v2OutNum;
      sellOut     = v3OutNum;
    } else {
      buyVersion  = `V3 (fee ${bestV3.fee/10000}%)`;
      sellVersion = 'V2';
      buyOut      = v3OutNum;
      sellOut     = v2OutNum;
    }

    // Estimasi profit (selisih output / input)
    const diff = Math.abs(v2OutNum - v3OutNum);
    const lowerOut = Math.min(v2OutNum, v3OutNum);
    const profitPct = diff / lowerOut;
    
    // Estimasi profit USD (asumsi tokenOut bernilai $1 untuk stablecoin atau pakai amountIn)
    const profitUSD = diff * (pair.to === 'USDT' || pair.to === 'BUSD' ? 1 : 
                              parseFloat(CONFIG.AMOUNT_IN_USDT) / v2OutNum);

    if (profitPct < CONFIG.MIN_PROFIT_PCT) continue;
    if (profitPct > CONFIG.MAX_PROFIT_PCT) continue;
    if (profitUSD < CONFIG.MIN_PROFIT_USD) continue;

    opps.push({
      pair: `${pair.from}/${pair.to}`,
      v2Price: v2OutNum,
      v3Price: v3OutNum,
      v3FeeTier: bestV3.fee,
      buyVersion, sellVersion,
      profitPct, profitUSD,
    });
  }

  return opps.sort((a,b) => b.profitUSD - a.profitUSD);
}

async function executeOpp(opp) {
  console.log('\n⚡ V2 vs V3 ARBITRAGE OPPORTUNITY');
  console.log(`   Pasangan  : ${opp.pair}`);
  console.log(`   V2 output : ${opp.v2Price.toFixed(6)}`);
  console.log(`   V3 output : ${opp.v3Price.toFixed(6)} (fee ${opp.v3FeeTier/10000}%)`);
  console.log(`   Beli di   : ${opp.buyVersion}`);
  console.log(`   Jual di   : ${opp.sellVersion}`);
  console.log(`   Est Profit: $${opp.profitUSD.toFixed(4)} (${(opp.profitPct*100).toFixed(4)}%)`);

  if (!CONFIG.EXECUTE_MODE) {
    console.log('   📝 SIMULASI (perlu deploy V2V3FlashArbitrage.sol untuk eksekusi)');
    return;
  }
  
  // Eksekusi LIVE akan diaktifkan setelah deploy contract
  console.log('   ⚠️  Eksekusi LIVE belum aktif - tunggu deploy contract');
}

async function scan() {
  scanCount++;
  const now = new Date();
  const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

  try {
    const opps = await findOpportunities();

    if (opps.length === 0) {
      console.log(`[${ts}] Scan #${scanCount} — Tidak ada selisih V2 vs V3`);
    } else {
      console.log(`[${ts}] Scan #${scanCount} — ✨ ${opps.length} peluang V2-V3!`);
      for (const opp of opps.slice(0, 3)) {
        console.log(`   → ${opp.pair}: ${opp.buyVersion} → ${opp.sellVersion} | $${opp.profitUSD.toFixed(4)} (${(opp.profitPct*100).toFixed(4)}%)`);
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
