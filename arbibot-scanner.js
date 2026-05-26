require("dotenv").config();
const { ethers } = require('ethers');

// ─────────────────────────────────────────────────────────
//  ARBIBOT TRADE SCANNER — Flash Loan Edition
//  PancakeSwap V3 Flash Loan + Multi-DEX Arbitrage
// ─────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL       : 'https://bsc-dataseed1.binance.org/',
  RPC_BACKUP    : 'https://bsc-dataseed2.binance.org/',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',
  CONTRACT_ADDR    : '0x4C37CAD6909305274373803b88f4D2ab5162f259',
  FLASH_EXECUTOR   : '0x9a19843c190c041ea46A8cc7091a1c5f0e822464',

  // Token addresses BSC
  TOKENS: {
    USDT  : '0x55d398326f99059fF775485246999027B3197955',
    WBNB  : '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    INDC  : '0xD772c96e1beFd2ea9C9a83182c71f4d32f306571',
    CAKE  : '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    BTCB  : '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    ETH   : '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    XRP   : '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE',
    ADA   : '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47',
    DOT   : '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402',
    LINK  : '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD',
    MATIC : '0xCC42724C6683B7E57334c4E856f4c9965ED682bD',
  },

  // DEX Routers
  ROUTERS: {
    PANCAKE_V2 : '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    BISWAP     : '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
  },

  // PancakeSwap V3 Pool Factory (untuk Flash Loan)
  PANCAKE_V3_FACTORY : '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',

  // PancakeSwap V3 USDT/WBNB Pool (paling likuid — untuk Flash Loan USDT)
  FLASH_POOL_USDT_WBNB : '0x172fcD41E0913e95784454622d1c3724f546f849',
  // Fee tier V3: 500 = 0.05%, 2500 = 0.25%, 10000 = 1%
  FLASH_FEE_TIER       : 500,

  // 20 Pasangan scan
  PAIRS: [
    { tokenIn: 'USDT', tokenOut: 'WBNB',  amountIn: '500'  },
    { tokenIn: 'USDT', tokenOut: 'BTCB',  amountIn: '500'  },
    { tokenIn: 'USDT', tokenOut: 'ETH',   amountIn: '500'  },
    { tokenIn: 'USDT', tokenOut: 'CAKE',  amountIn: '300'  },
    { tokenIn: 'USDT', tokenOut: 'XRP',   amountIn: '300'  },
    { tokenIn: 'USDT', tokenOut: 'ADA',   amountIn: '300'  },
    { tokenIn: 'USDT', tokenOut: 'DOT',   amountIn: '300'  },
    { tokenIn: 'USDT', tokenOut: 'LINK',  amountIn: '300'  },
    { tokenIn: 'USDT', tokenOut: 'MATIC', amountIn: '300'  },
    { tokenIn: 'USDT', tokenOut: 'INDC',  amountIn: '100'  },
    { tokenIn: 'WBNB', tokenOut: 'BTCB',  amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'ETH',   amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'CAKE',  amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'XRP',   amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'ADA',   amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'DOT',   amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'LINK',  amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'MATIC', amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'USDT',  amountIn: '1'    },
    { tokenIn: 'WBNB', tokenOut: 'INDC',  amountIn: '1'    },
  ],

  MIN_PROFIT_PCT : 0.005,   // 0.5% minimum profit setelah flash loan fee
  MAX_PROFIT_PCT : 0.05,    // 5% maksimum — lebih dari ini = likuiditas tipis/harga palsu
  FLASH_FEE_PCT  : 0.0001,  // 0.01% flash loan fee PancakeSwap V3
  GAS_BUFFER_USD : 0.5,     // $0.50 buffer gas
  SCAN_INTERVAL  : 5,       // 5 detik — lebih kompetitif
  MAX_TRADE_USD  : 2000,
  COOLDOWN_MS    : 35000,
};

// ─────────────────────────────────────────────────────────
//  ABIs
// ─────────────────────────────────────────────────────────

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
];

const ROUTER_V2_ABI = [
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256) returns (uint256[])',
];

// PancakeSwap V3 Pool — Flash fungsi
const PANCAKE_V3_POOL_ABI = [
  'function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

// ArbiFlashExecutor contract
const FLASH_EXECUTOR_ABI = [
  'function executeArbitrage(address tokenIn, address tokenOut, uint256 amount, address buyRouter, address sellRouter, address topUser) external',
];

// Contract INDOCOIN ArbiBotTrade
const CONTRACT_ABI = [
  'function distributeProfit(address user, uint256 grossProfit) external',
  'function reportLoss(uint256 lossAmt) external',
  'function getPublicStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
  'function getUserInfo(address) view returns (uint256,uint256,uint256,bool,bool)',
  'function totalUserDeposits() view returns (uint256)',
];

// ─────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────
let provider, signer, contract, flashExecutor;
let scanCount   = 0;
let totalArbi   = 0;
let totalProfit = 0;
let isRunning   = false;
let lastExecTime = 0;

// ─────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────
async function init() {
  console.log('🤖 ArbiBot Trade Scanner — Flash Loan Edition');
  console.log('='.repeat(50));

  try {
    provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
    await provider.getBlockNumber();
    console.log('✅ Connected to BSC via primary RPC');
  } catch(e) {
    provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_BACKUP);
    console.log('✅ Connected to BSC via backup RPC');
  }

  signer   = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  contract       = new ethers.Contract(CONFIG.CONTRACT_ADDR, CONTRACT_ABI, signer);
  flashExecutor  = new ethers.Contract(CONFIG.FLASH_EXECUTOR, FLASH_EXECUTOR_ABI, signer);
  console.log('⚡ FlashExecutor :', CONFIG.FLASH_EXECUTOR);

  console.log('🔑 Bot wallet:', signer.address);
  console.log('📋 Contract :', CONFIG.CONTRACT_ADDR);

  const bnbBal = await provider.getBalance(signer.address);
  const bnbEth = parseFloat(ethers.utils.formatEther(bnbBal));
  console.log(`⛽ BNB balance: ${bnbEth.toFixed(6)} BNB`);

  if (bnbEth < 0.01) {
    console.warn('⚠️  BNB rendah! Isi BNB untuk gas fee eksekusi Flash Loan.');
  }
}

// ─────────────────────────────────────────────────────────
//  SCAN HARGA DI DEX
// ─────────────────────────────────────────────────────────
async function getDexPrice(routerAddr, tokenIn, tokenOut, amountIn) {
  try {
    const router  = new ethers.Contract(routerAddr, ROUTER_V2_ABI, provider);
    const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
    return amounts[1];
  } catch(e) {
    return null;
  }
}

async function findArbitrageOpportunities() {
  const opps = [];

  for (const pair of CONFIG.PAIRS) {
    try {
      const tokenInAddr  = CONFIG.TOKENS[pair.tokenIn];
      const tokenOutAddr = CONFIG.TOKENS[pair.tokenOut];
      const decimals     = pair.tokenIn === 'WBNB' ? 18 : 18;
      const amountIn     = ethers.utils.parseUnits(pair.amountIn, decimals);

      // Cek harga di 2 DEX
      const [pricePancake, priceBiswap] = await Promise.all([
        getDexPrice(CONFIG.ROUTERS.PANCAKE_V2, tokenInAddr, tokenOutAddr, amountIn),
        getDexPrice(CONFIG.ROUTERS.BISWAP,     tokenInAddr, tokenOutAddr, amountIn),
      ]);

      if (!pricePancake || !priceBiswap) continue;

      // Hitung selisih
      const pancakeNum = parseFloat(ethers.utils.formatUnits(pricePancake, decimals));
      const biswapNum  = parseFloat(ethers.utils.formatUnits(priceBiswap,  decimals));
      const amountNum  = parseFloat(pair.amountIn);

      let profitPct = 0, buyDex = '', sellDex = '', buyRouter = '', sellRouter = '';

      if (pancakeNum > biswapNum) {
        // Beli di BiSwap, jual di PancakeSwap
        profitPct  = (pancakeNum - biswapNum) / biswapNum;
        buyDex     = 'BiSwap';
        sellDex    = 'PancakeSwap';
        buyRouter  = CONFIG.ROUTERS.BISWAP;
        sellRouter = CONFIG.ROUTERS.PANCAKE_V2;
      } else {
        // Beli di PancakeSwap, jual di BiSwap
        profitPct  = (biswapNum - pancakeNum) / pancakeNum;
        buyDex     = 'PancakeSwap';
        sellDex    = 'BiSwap';
        buyRouter  = CONFIG.ROUTERS.PANCAKE_V2;
        sellRouter = CONFIG.ROUTERS.BISWAP;
      }

      // Kurangi flash loan fee 0.05%
      const netProfitPct = profitPct - CONFIG.FLASH_FEE_PCT;

      if (netProfitPct >= CONFIG.MIN_PROFIT_PCT) {
        const estimatedProfitUSD = amountNum * netProfitPct;
        if (estimatedProfitUSD > CONFIG.GAS_BUFFER_USD) {
          opps.push({
            tokenIn       : pair.tokenIn,
            tokenOut      : pair.tokenOut,
            tokenInAddr,
            tokenOutAddr,
            amountIn,
            amountInNum   : amountNum,
            buyDex,
            sellDex,
            buyRouter,
            sellRouter,
            profitPct     : netProfitPct,
            estimatedProfit: estimatedProfitUSD,
          });
        }
      }
    } catch(e) {
      // Skip pair yang error
    }
  }

  // Urutkan dari profit terbesar
  return opps.sort((a,b) => b.estimatedProfit - a.estimatedProfit);
}

// ─────────────────────────────────────────────────────────
//  FLASH LOAN EXECUTOR
//  Menggunakan PancakeSwap V3 Pool Flash
// ─────────────────────────────────────────────────────────
async function executeFlashLoan(opp) {
  console.log('\n⚡ EKSEKUSI FLASH LOAN ARBITRAGE');
  console.log(`   Pasangan   : ${opp.tokenIn}/${opp.tokenOut}`);
  console.log(`   Beli di    : ${opp.buyDex}`);
  console.log(`   Jual di    : ${opp.sellDex}`);
  console.log(`   Modal      : $${opp.amountInNum} (Flash Loan — tanpa modal sendiri)`);
  console.log(`   Est. Profit: $${opp.estimatedProfit.toFixed(4)}`);

  try {
    // Cek BNB untuk gas
    const bnbBal = await provider.getBalance(signer.address);
    const bnbEth = parseFloat(ethers.utils.formatEther(bnbBal));
    if (bnbEth < 0.005) {
      console.warn('  ⚠️  BNB tidak cukup untuk gas! Minimal 0.005 BNB');
      return;
    }

    // Panggil FlashExecutor contract
    // Contract yang akan handle Flash Loan + arbitrage + kembalikan pinjaman
    const tx = await flashExecutor.executeArbitrage(
      opp.tokenInAddr,
      opp.tokenOutAddr,
      opp.amountIn,
      opp.buyRouter,
      opp.sellRouter,
      signer.address, // topUser — untuk distribusi profit
      { gasLimit: 600000 }
    );

    console.log('   Menunggu konfirmasi...');
    const receipt = await tx.wait();
    console.log(`✅ Sukses! TX: ${receipt.transactionHash.slice(0,20)}...`);
    console.log(`   Gas used : ${receipt.gasUsed.toString()}`);

    totalArbi++;
    lastExecTime = Date.now();
    console.log(`📊 Total eksekusi: ${totalArbi}`);

  } catch(e) {
    console.error('  ❌ Flash Loan gagal:', e.message);
    try {
      await contract.reportLoss(ethers.utils.parseUnits('1', 18));
    } catch(re) {}
  }
}

// ─────────────────────────────────────────────────────────
//  CALLBACK HANDLER — dipanggil setelah menerima flash loan
//  Bot perlu menjalankan arbitrage DAN mengembalikan pinjaman
//  dalam 1 transaksi
// ─────────────────────────────────────────────────────────
async function handleFlashCallback(tokenIn, tokenOut, buyRouter, sellRouter, amount) {
  // Step 1: Approve tokenIn ke buyRouter
  await ensureApproval(tokenIn, buyRouter, amount);

  const deadline = Math.floor(Date.now() / 1000) + 120;

  // Step 2: Beli tokenOut di buyDex
  const buyR = new ethers.Contract(buyRouter, ROUTER_V2_ABI, signer);
  const buyTx = await buyR.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    amount, 0, [tokenIn, tokenOut], signer.address, deadline,
    { gasLimit: 300000 }
  );
  await buyTx.wait();

  // Step 3: Cek saldo tokenOut yang didapat
  const tokenOutC  = new ethers.Contract(tokenOut, ERC20_ABI, provider);
  const tokenOutBal = await tokenOutC.balanceOf(signer.address);

  // Step 4: Approve tokenOut ke sellRouter
  await ensureApproval(tokenOut, sellRouter, tokenOutBal);

  // Step 5: Jual tokenOut kembali ke tokenIn di sellDex
  const sellR = new ethers.Contract(sellRouter, ROUTER_V2_ABI, signer);
  const sellTx = await sellR.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    tokenOutBal, amount, [tokenOut, tokenIn], signer.address, deadline,
    { gasLimit: 300000 }
  );
  await sellTx.wait();

  // Flash loan fee otomatis dipotong dari saldo saat pool.flash() selesai
}

// ─────────────────────────────────────────────────────────
//  DISTRIBUSI PROFIT KE CONTRACT
// ─────────────────────────────────────────────────────────
async function distributeToContract(tokenAddr, profitWei, profitUSD) {
  try {
    // Cek siapa user dengan deposit terbesar di contract
    const totalDeposits = await contract.totalUserDeposits();
    if (totalDeposits.eq(0)) {
      console.log('  ℹ️  Belum ada user deposit — profit disimpan di bot wallet');
      return;
    }

    // Transfer profit USDT ke contract dulu
    const tokenC = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
    await ensureApproval(tokenAddr, CONFIG.CONTRACT_ADDR, profitWei);

    // Distribusi profit proporsional — contract handles distribusi
    // Untuk saat ini: log profit, nanti implementasi distribusi per-user
    console.log(`  💰 Profit $${profitUSD.toFixed(4)} siap didistribusikan ke user`);
    console.log(`  📊 Total trades: ${totalArbi} | Total profit: $${totalProfit.toFixed(4)}`);

  } catch(e) {
    console.error('  ❌ Distribusi gagal:', e.message);
  }
}

// ─────────────────────────────────────────────────────────
//  APPROVE TOKEN
// ─────────────────────────────────────────────────────────
async function ensureApproval(tokenAddr, spender, amount) {
  try {
    const token     = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
    const allowance = await token.allowance(signer.address, spender);
    if (allowance.lt(amount)) {
      const approveTx = await token.approve(spender, ethers.constants.MaxUint256, { gasLimit: 100000 });
      await approveTx.wait();
    }
  } catch(e) {
    // Skip jika gagal approve
  }
}

// ─────────────────────────────────────────────────────────
//  MAIN SCAN LOOP
// ─────────────────────────────────────────────────────────
async function scanAndExecute() {
  if (isRunning) return;
  isRunning = true;
  scanCount++;

  const now = new Date();
  const ts  = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

  try {
    process.stdout.write(`[${ts}] Scan #${scanCount} — `);

    const opps = await findArbitrageOpportunities();

    if (opps.length === 0) {
      console.log('Tidak ada peluang arbitrage saat ini');
    } else {
      console.log(`✨ ${opps.length} peluang ditemukan!`);
      opps.forEach(o => {
        console.log(`   → ${o.tokenIn}/${o.tokenOut}: ${(o.profitPct*100).toFixed(3)}% profit (~$${o.estimatedProfit.toFixed(4)}) | Beli ${o.buyDex} → Jual ${o.sellDex}`);
      });

      // Eksekusi peluang terbaik
      const best = opps[0];
      const cooldownOk = Date.now() - lastExecTime > CONFIG.COOLDOWN_MS;

      if (cooldownOk) {
        await executeFlashLoan(best);
      } else {
        const wait = Math.ceil((CONFIG.COOLDOWN_MS - (Date.now() - lastExecTime)) / 1000);
        console.log(`   ⏳ Cooldown: tunggu ${wait}s lagi`);
      }
    }

  } catch(e) {
    console.error(`❌ Scanner error: ${e.message}`);
    try { await contract.reportLoss(ethers.utils.parseUnits('1', 18)); } catch(re) {}
  }

  isRunning = false;
}

// ─────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────
async function startScanner() {
  console.log(`\n🔄 Scanner aktif — interval ${CONFIG.SCAN_INTERVAL}s\n`);
  await scanAndExecute();
  setInterval(scanAndExecute, CONFIG.SCAN_INTERVAL * 1000);
}

// ─────────────────────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────────────────────
init()
  .then(startScanner)
  .catch(e => {
    console.error('❌ Fatal error:', e.message);
    process.exit(1);
  });
