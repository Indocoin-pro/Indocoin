require("dotenv").config();
const { ethers } = require('ethers');

// ─────────────────────────────────────────────────────────
//  STABLECOIN ARBITRAGE BOT — INDOCOIN
//  Cari selisih harga stablecoin antar DEX
//  USDT ↔ BUSD ↔ USDC ↔ DAI
//  Pakai ArbiFlashExecutor yang sudah ada (zero modal)
// ─────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL       : 'https://bsc.publicnode.com',
  RPC_BACKUP    : 'https://binance.llamarpc.com',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',

  ARBIBOT_TRADE  : '0x4C37CAD6909305274373803b88f4D2ab5162f259',
  FLASH_EXECUTOR : '0x642095543018f668f18169b165e1e55eca842e63',

  TOKENS: {
    USDT  : { addr: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    BUSD  : { addr: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
    USDC  : { addr: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    DAI   : { addr: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', decimals: 18 },
  },

  ROUTERS: {
    PANCAKE_V2 : '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    BISWAP     : '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
  },

  // Pasangan stablecoin yang discan
  // Catatan: tokenIn HARUS USDT karena flash pool USDT/WBNB
  PAIRS: [
    { tokenIn: 'USDT', tokenOut: 'BUSD' },
  ],

  // Coba berbagai modal — beda modal = beda peluang slippage
  AMOUNT_IN_USDT_LIST: ['500', '1000', '3000', '5000'],
  MIN_PROFIT_USD   : 0.5,     // minimal $0.50 profit
  MIN_PROFIT_PCT   : 0.006,   // minimal 0.6% (cover fee swap 2x + flash loan + slippage)
  MAX_PROFIT_PCT   : 0.005,   // > 0.5% = palsu untuk stablecoin
  SCAN_INTERVAL    : 12,      // detik
  COOLDOWN_AFTER_TX: 30,
  EXECUTE_MODE     : false,
};

const ROUTER_ABI = [
  'function getAmountsOut(uint256, address[]) view returns (uint256[])',
];

const EXECUTOR_ABI = [
  'function executeArbitrage(address tokenIn, address tokenOut, uint256 amount, address buyRouter, address sellRouter, address topUser) external',
];

const ARBIBOT_ABI = [
  'function getTopUser() view returns (address)',
];

let provider, signer, executor, arbibotTrade;
let scanCount = 0, lastExecTime = 0, totalExec = 0;

async function init() {
  console.log('💵 Stablecoin Arbitrage Bot — INDOCOIN');
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
  executor = new ethers.Contract(CONFIG.FLASH_EXECUTOR, EXECUTOR_ABI, signer);
  arbibotTrade = new ethers.Contract(CONFIG.ARBIBOT_TRADE, ARBIBOT_ABI, signer);

  console.log('🔑 Bot wallet:', signer.address);
  console.log('💰 Profit ke:', CONFIG.ARBIBOT_TRADE);
  console.log('⚡ FlashExecutor:', CONFIG.FLASH_EXECUTOR);
  console.log('🎯 Mode:', CONFIG.EXECUTE_MODE ? '🔴 LIVE' : '🟢 SIMULASI');

  const bnb = await provider.getBalance(signer.address);
  console.log(`⛽ BNB: ${parseFloat(ethers.utils.formatEther(bnb)).toFixed(6)}\n`);
}

async function getDexPrice(router, tokenIn, tokenOut, amountIn) {
  try {
    const r = new ethers.Contract(router, ROUTER_ABI, provider);
    const result = await r.getAmountsOut(amountIn, [tokenIn, tokenOut]);
    return result[1];
  } catch(e) {
    return null;
  }
}

async function findOpportunities() {
  const opps = [];
  const routers = Object.entries(CONFIG.ROUTERS);

  // Iterasi setiap modal yang berbeda
  for (const amountStr of CONFIG.AMOUNT_IN_USDT_LIST) {
    const amountIn = ethers.utils.parseUnits(amountStr, 18);

    for (const pair of CONFIG.PAIRS) {
      const tokenInAddr  = CONFIG.TOKENS[pair.tokenIn].addr;
      const tokenOutAddr = CONFIG.TOKENS[pair.tokenOut].addr;

      const prices = await Promise.all(
        routers.map(([name, router]) => getDexPrice(router, tokenInAddr, tokenOutAddr, amountIn))
      );

      const validDex = routers.map(([name, router], i) => ({
        name, router, price: prices[i]
      })).filter(d => d.price !== null);

      if (validDex.length < 2) continue;

      const sortedDex = validDex.map(d => ({
        ...d,
        priceNum: parseFloat(ethers.utils.formatUnits(d.price, 18))
      })).sort((a,b) => a.priceNum - b.priceNum);

      const buyAt  = sortedDex[sortedDex.length - 1];
      const sellAt = sortedDex[0];

      const profitPct = (buyAt.priceNum - sellAt.priceNum) / sellAt.priceNum;
      const profitUSD = (buyAt.priceNum - sellAt.priceNum);

      if (profitPct > CONFIG.MAX_PROFIT_PCT) continue;
      if (profitPct < CONFIG.MIN_PROFIT_PCT) continue;
      if (profitUSD < CONFIG.MIN_PROFIT_USD) continue;

      opps.push({
        pair: `${pair.tokenIn}/${pair.tokenOut}`,
        tokenInAddr, tokenOutAddr,
        amountIn,
        amountStr,
        buyDex: buyAt.name, sellDex: sellAt.name,
        buyRouter: buyAt.router, sellRouter: sellAt.router,
        profitUSD, profitPct,
      });
    }
  }

  return opps.sort((a,b) => b.profitUSD - a.profitUSD);
}

async function executeOpp(opp) {
  console.log('\n⚡ EKSEKUSI STABLECOIN ARBITRAGE');
  console.log(`   Pasangan  : ${opp.pair}`);
  console.log(`   Beli di   : ${opp.buyDex}`);
  console.log(`   Jual di   : ${opp.sellDex}`);
  console.log(`   Modal     : $${opp.amountStr} (Flash Loan)`);
  console.log(`   Est Profit: $${opp.profitUSD.toFixed(4)} (${(opp.profitPct*100).toFixed(4)}%)`);

  if (!CONFIG.EXECUTE_MODE) {
    console.log('   📝 SIMULASI');
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

    const tx = await executor.executeArbitrage(
      opp.tokenInAddr, opp.tokenOutAddr, opp.amountIn,
      opp.buyRouter, opp.sellRouter, topUser,
      { gasLimit: 800000 }
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

  const elapsed = (Date.now() - lastExecTime) / 1000;
  if (elapsed < CONFIG.COOLDOWN_AFTER_TX) {
    console.log(`[${ts}] Scan #${scanCount} — ⏳ Cooldown: ${Math.ceil(CONFIG.COOLDOWN_AFTER_TX - elapsed)}s`);
    return;
  }

  try {
    const opps = await findOpportunities();

    if (opps.length === 0) {
      console.log(`[${ts}] Scan #${scanCount} — Tidak ada selisih stablecoin`);
    } else {
      console.log(`[${ts}] Scan #${scanCount} — ✨ ${opps.length} peluang!`);
      for (const opp of opps.slice(0, 3)) {
        console.log(`   → ${opp.pair} [$${opp.amountStr}]: $${opp.profitUSD.toFixed(4)} (${(opp.profitPct*100).toFixed(4)}%) | ${opp.buyDex} → ${opp.sellDex}`);
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
