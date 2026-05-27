require("dotenv").config();
const { ethers } = require('ethers');

// ─────────────────────────────────────────────────────────
//  TRIANGULAR ARBITRAGE BOT — INDOCOIN
//  USDT → tokenB → tokenC → USDT (3 swap berturut-turut)
//  Profit otomatis ke ArbiBotTrade
// ─────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL       : 'https://bsc.publicnode.com',
  RPC_BACKUP    : 'https://binance.llamarpc.com',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',

  ARBIBOT_TRADE        : '0x4C37CAD6909305274373803b88f4D2ab5162f259',
  TRIANGULAR_EXECUTOR  : '0xec104da3e46abf41090c7533c089a9698db93fa0',

  TOKENS: {
    USDT  : '0x55d398326f99059fF775485246999027B3197955',
    WBNB  : '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    BTCB  : '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    ETH   : '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    CAKE  : '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    BUSD  : '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  },

  ROUTERS: {
    PANCAKE_V2 : '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    BISWAP     : '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
    APESWAP    : '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7',
    MDEX       : '0x7DAe51BD3E3376B8c7c4900E9107f12Be3AF1bA8',
  },

  // Pasangan triangular untuk discan
  // [tokenB, tokenC] — start & end selalu USDT
  TRIANGLES: [
    ['WBNB', 'BTCB'],
    ['WBNB', 'ETH'],
    ['WBNB', 'CAKE'],
    ['BTCB', 'WBNB'],
    ['ETH',  'WBNB'],
    ['BTCB', 'ETH'],
    ['ETH',  'BTCB'],
    ['CAKE', 'WBNB'],
    ['BUSD', 'WBNB'],
    ['WBNB', 'BUSD'],
  ],

  AMOUNT_IN_USDT   : '300',   // jumlah pinjam per percobaan
  MIN_PROFIT_USD   : 0.5,     // minimal profit
  MAX_PROFIT_PCT   : 0.05,    // > 5% = palsu, skip
  SCAN_INTERVAL    : 8,       // detik
  COOLDOWN_AFTER_TX: 30,      // detik setelah eksekusi
  EXECUTE_MODE     : false,   // false = simulasi
};

const ROUTER_ABI = [
  'function getAmountsOut(uint256, address[]) view returns (uint256[])',
];

const EXECUTOR_ABI = [
  'function executeTriangular(uint256 amountIn, address tokenB, address tokenC, address router1, address router2, address router3, address topUser) external',
];

const ARBIBOT_ABI = [
  'function getTopUser() view returns (address)',
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
];

let provider, signer, executor, arbibotTrade;
let scanCount = 0, lastExecTime = 0, totalExec = 0;
let cachedDecimals = {};

async function init() {
  console.log('🔺 Triangular Arbitrage Bot — INDOCOIN');
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

  if (CONFIG.TRIANGULAR_EXECUTOR === 'BELUM_DEPLOY') {
    console.log('⚠️  TRIANGULAR_EXECUTOR belum di-set!');
    console.log('   Deploy TriangularExecutor.sol dulu, lalu update address.');
  } else {
    executor = new ethers.Contract(CONFIG.TRIANGULAR_EXECUTOR, EXECUTOR_ABI, signer);
  }

  arbibotTrade = new ethers.Contract(CONFIG.ARBIBOT_TRADE, ARBIBOT_ABI, signer);

  console.log('🔑 Bot wallet:', signer.address);
  console.log('💰 Profit ke:', CONFIG.ARBIBOT_TRADE);
  console.log('⚡ Executor:', CONFIG.TRIANGULAR_EXECUTOR);
  console.log('🎯 Mode:', CONFIG.EXECUTE_MODE ? '🔴 LIVE' : '🟢 SIMULASI');

  const bnb = await provider.getBalance(signer.address);
  console.log(`⛽ BNB: ${parseFloat(ethers.utils.formatEther(bnb)).toFixed(6)}\n`);
}

async function getDecimals(token) {
  if (cachedDecimals[token]) return cachedDecimals[token];
  const c = new ethers.Contract(token, ERC20_ABI, provider);
  const d = await c.decimals();
  cachedDecimals[token] = d;
  return d;
}

async function quoteSwap(router, tokenIn, tokenOut, amountIn) {
  try {
    const r = new ethers.Contract(router, ROUTER_ABI, provider);
    const result = await r.getAmountsOut(amountIn, [tokenIn, tokenOut]);
    return result[1];
  } catch(e) {
    return null;
  }
}

async function findTriangular() {
  const usdt = CONFIG.TOKENS.USDT;
  const amountIn = ethers.utils.parseUnits(CONFIG.AMOUNT_IN_USDT, 18);
  const opportunities = [];
  const routers = Object.entries(CONFIG.ROUTERS);

  for (const [bSymbol, cSymbol] of CONFIG.TRIANGLES) {
    const tokenB = CONFIG.TOKENS[bSymbol];
    const tokenC = CONFIG.TOKENS[cSymbol];
    
    // Coba semua kombinasi router untuk 3 swap
    for (const [r1Name, r1] of routers) {
      // SWAP 1: USDT → tokenB
      const amountB = await quoteSwap(r1, usdt, tokenB, amountIn);
      if (!amountB || amountB.eq(0)) continue;
      
      for (const [r2Name, r2] of routers) {
        // SWAP 2: tokenB → tokenC
        const amountC = await quoteSwap(r2, tokenB, tokenC, amountB);
        if (!amountC || amountC.eq(0)) continue;
        
        for (const [r3Name, r3] of routers) {
          // SWAP 3: tokenC → USDT
          const amountOut = await quoteSwap(r3, tokenC, usdt, amountC);
          if (!amountOut || amountOut.lte(amountIn)) continue;
          
          const profit = amountOut.sub(amountIn);
          const profitUSD = parseFloat(ethers.utils.formatUnits(profit, 18));
          const profitPct = profitUSD / parseFloat(CONFIG.AMOUNT_IN_USDT);
          
          // Filter peluang palsu (> 5%)
          if (profitPct > CONFIG.MAX_PROFIT_PCT) continue;
          if (profitUSD < CONFIG.MIN_PROFIT_USD) continue;
          
          opportunities.push({
            tokenB, tokenC, bSymbol, cSymbol,
            r1, r2, r3, r1Name, r2Name, r3Name,
            amountIn, profitUSD, profitPct,
          });
        }
      }
    }
  }
  
  return opportunities.sort((a,b) => b.profitUSD - a.profitUSD);
}

async function executeOpp(opp) {
  console.log('\n⚡ EKSEKUSI TRIANGULAR');
  console.log(`   Jalur     : USDT → ${opp.bSymbol} → ${opp.cSymbol} → USDT`);
  console.log(`   Router    : ${opp.r1Name} → ${opp.r2Name} → ${opp.r3Name}`);
  console.log(`   Modal     : $${CONFIG.AMOUNT_IN_USDT} (Flash Loan)`);
  console.log(`   Est Profit: $${opp.profitUSD.toFixed(4)} (${(opp.profitPct*100).toFixed(3)}%)`);
  
  if (!CONFIG.EXECUTE_MODE) {
    console.log('   📝 SIMULASI');
    return;
  }
  
  if (!executor) {
    console.warn('   ⚠️  Executor contract belum di-set');
    return;
  }
  
  try {
    const bnb = await provider.getBalance(signer.address);
    if (parseFloat(ethers.utils.formatEther(bnb)) < 0.005) {
      console.warn('   ⚠️  BNB tidak cukup');
      return;
    }
    
    let topUser = '0x0000000000000000000000000000000000000000';
    try { topUser = await arbibotTrade.getTopUser(); } catch(e) {}
    
    const tx = await executor.executeTriangular(
      opp.amountIn, opp.tokenB, opp.tokenC,
      opp.r1, opp.r2, opp.r3, topUser,
      { gasLimit: 1500000 }
    );
    
    console.log(`   📡 TX: ${tx.hash.slice(0,20)}...`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log(`   ✅ SUCCESS!`);
      totalExec++;
    } else {
      console.log(`   ❌ Revert`);
    }
    
    lastExecTime = Date.now();
    
  } catch(e) {
    console.error('   ❌ Gagal:', e.message.slice(0,80));
  }
}

async function scan() {
  scanCount++;
  const now = new Date();
  const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
  
  // Cooldown setelah eksekusi
  const elapsed = (Date.now() - lastExecTime) / 1000;
  if (elapsed < CONFIG.COOLDOWN_AFTER_TX) {
    console.log(`[${ts}] Scan #${scanCount} — ⏳ Cooldown: ${Math.ceil(CONFIG.COOLDOWN_AFTER_TX - elapsed)}s`);
    return;
  }
  
  try {
    const opps = await findTriangular();
    
    if (opps.length === 0) {
      console.log(`[${ts}] Scan #${scanCount} — Tidak ada peluang triangular`);
    } else {
      console.log(`[${ts}] Scan #${scanCount} — ✨ ${opps.length} peluang!`);
      for (const opp of opps.slice(0, 3)) {
        console.log(`   USDT→${opp.bSymbol}→${opp.cSymbol}→USDT: $${opp.profitUSD.toFixed(4)} (${(opp.profitPct*100).toFixed(3)}%) | ${opp.r1Name}→${opp.r2Name}→${opp.r3Name}`);
      }
      
      // Eksekusi yang terbaik
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
