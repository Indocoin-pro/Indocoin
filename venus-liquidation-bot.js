require("dotenv").config();
const { ethers } = require('ethers');

// ─────────────────────────────────────────────────────────
//  VENUS LIQUIDATION BOT — INDOCOIN
//  Monitor & eksekusi liquidation di Venus Protocol BSC
//  Profit otomatis masuk ke ArbiBotTrade → dibagi ke user
// ─────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL       : 'https://bsc-dataseed1.binance.org/',
  RPC_BACKUP    : 'https://bsc-dataseed2.binance.org/',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',

  // Contract INDOCOIN (untuk kirim profit ke user)
  ARBIBOT_TRADE : '0x4C37CAD6909305274373803b88f4D2ab5162f259',

  // Venus Protocol BSC Addresses
  COMPTROLLER   : '0xfD36E2c2a6789Db23113685031d7F16329158384',
  VBNB          : '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  VUSDT         : '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  VBUSD         : '0x95c78222B3D6e262426483D42CfA53685A67Ab9D',
  VBTC          : '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
  VETH          : '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
  VUSDC         : '0xeCA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  VCAKE         : '0x86aC3974e2BD0d60825230fa6F355fF11409df5c',
  VLINK         : '0x650b940a1033B8A1b1873f78730FcFC73ec11f1f',
  VXRP          : '0xB248a295732e0225acd3337607cc01068e3b9c10',

  // Token addresses
  USDT          : '0x55d398326f99059fF775485246999027B3197955',
  BUSD          : '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  WBNB          : '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',

  // PancakeSwap Router (untuk jual collateral)
  PANCAKE_ROUTER: '0x10ED43C718714eb63d5aA57B78B54704E256024E',

  // Setting
  MIN_HEALTH_FACTOR : 1.0,    // < 1.0 = bisa liquidate
  MIN_PROFIT_USD    : 5,      // skip kalau profit < $5
  MAX_REPAY_USD     : 1000,   // maksimal repay per liquidation
  SCAN_INTERVAL     : 15,     // detik
  CLOSE_FACTOR      : 0.5,    // Venus: bisa liquidate 50% hutang
  LIQUIDATION_BONUS : 0.10,   // Venus: 10% bonus

  // Daftar borrower yang dipantau
  // Untuk awal: monitor borrower terbesar Venus
  // Idealnya: indexing event Borrow dari Comptroller
  WATCH_BORROWERS: [
    // TOP borrowers Venus BSC (perlu update berkala)
    // Bisa diisi dari https://app.venus.io/governance/leaderboard
    // atau scan event Borrow dari blockchain
  ],
};

// ─────────────────────────────────────────────────────────
//  ABIs
// ─────────────────────────────────────────────────────────

const COMPTROLLER_ABI = [
  'function getAccountLiquidity(address) view returns (uint256 err, uint256 liquidity, uint256 shortfall)',
  'function getAssetsIn(address) view returns (address[])',
  'function markets(address) view returns (bool isListed, uint256 collateralFactor, bool isComped)',
  'function oracle() view returns (address)',
  'function liquidationIncentiveMantissa() view returns (uint256)',
  'function closeFactorMantissa() view returns (uint256)',
];

const VTOKEN_ABI = [
  'function borrowBalanceStored(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function exchangeRateStored() view returns (uint256)',
  'function underlying() view returns (address)',
  'function liquidateBorrow(address borrower, uint256 repayAmount, address vTokenCollateral) returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
];

const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])',
];

const ARBIBOT_ABI = [
  'function distributeProfit(address user, uint256 grossProfit) external',
  'function totalUserDeposits() view returns (uint256)',
];

// ─────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────
let provider, signer, comptroller, arbibotTrade;
let scanCount = 0;
let totalLiquidations = 0;
let totalProfit = 0;
let isRunning = false;

// ─────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────
async function init() {
  console.log('💧 Venus Liquidation Bot — INDOCOIN');
  console.log('═'.repeat(50));

  try {
    provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
    await provider.getBlockNumber();
    console.log('✅ Connected to BSC');
  } catch(e) {
    provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_BACKUP);
    console.log('✅ Connected to BSC (backup RPC)');
  }

  signer        = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  comptroller   = new ethers.Contract(CONFIG.COMPTROLLER, COMPTROLLER_ABI, signer);
  arbibotTrade  = new ethers.Contract(CONFIG.ARBIBOT_TRADE, ARBIBOT_ABI, signer);

  console.log('🔑 Bot wallet:', signer.address);
  console.log('📋 Venus Comptroller:', CONFIG.COMPTROLLER);
  console.log('💰 Profit ke:', CONFIG.ARBIBOT_TRADE);

  const bnbBal = await provider.getBalance(signer.address);
  const bnbEth = parseFloat(ethers.utils.formatEther(bnbBal));
  console.log(`⛽ BNB balance: ${bnbEth.toFixed(6)} BNB`);

  const usdtBal = await new ethers.Contract(CONFIG.USDT, ERC20_ABI, provider).balanceOf(signer.address);
  const usdtNum = parseFloat(ethers.utils.formatUnits(usdtBal, 18));
  console.log(`💵 USDT balance: ${usdtNum.toFixed(2)} USDT`);

  console.log(`👁️  Monitoring ${CONFIG.WATCH_BORROWERS.length} borrower\n`);
}

// ─────────────────────────────────────────────────────────
//  CEK HEALTH FACTOR BORROWER
// ─────────────────────────────────────────────────────────
async function checkBorrower(borrower) {
  try {
    const [err, liquidity, shortfall] = await comptroller.getAccountLiquidity(borrower);
    
    if (err.toNumber() !== 0) return null;
    
    // Shortfall > 0 = borrower under-collateralized = bisa liquidate
    if (shortfall.eq(0)) return null;
    
    const shortfallUSD = parseFloat(ethers.utils.formatUnits(shortfall, 18));
    if (shortfallUSD < CONFIG.MIN_PROFIT_USD) return null;

    // Cari asset yang dipinjam dan dijaminkan
    const assetsIn = await comptroller.getAssetsIn(borrower);
    
    let borrowedAsset = null, collateralAsset = null;
    let maxBorrow = ethers.BigNumber.from(0);
    let maxCollateral = ethers.BigNumber.from(0);
    
    for (const vToken of assetsIn) {
      const v = new ethers.Contract(vToken, VTOKEN_ABI, provider);
      
      // Cek hutang
      const borrow = await v.borrowBalanceStored(borrower);
      if (borrow.gt(maxBorrow)) {
        maxBorrow = borrow;
        borrowedAsset = vToken;
      }
      
      // Cek collateral
      const balance = await v.balanceOf(borrower);
      if (balance.gt(maxCollateral)) {
        maxCollateral = balance;
        collateralAsset = vToken;
      }
    }
    
    if (!borrowedAsset || !collateralAsset) return null;
    
    return {
      borrower,
      shortfallUSD,
      borrowedAsset,
      collateralAsset,
      maxBorrow,
      // Bisa liquidate maksimum 50% dari hutang
      repayAmount: maxBorrow.mul(50).div(100),
    };
    
  } catch(e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
//  EKSEKUSI LIQUIDATION
// ─────────────────────────────────────────────────────────
async function executeLiquidation(opp) {
  console.log('\n⚡ EKSEKUSI LIQUIDATION');
  console.log(`   Borrower    : ${opp.borrower.slice(0,10)}...`);
  console.log(`   Shortfall   : $${opp.shortfallUSD.toFixed(2)}`);
  console.log(`   Repay       : ${ethers.utils.formatUnits(opp.repayAmount, 18).slice(0,8)}`);
  console.log(`   Est. Bonus  : ${(opp.shortfallUSD * CONFIG.LIQUIDATION_BONUS).toFixed(2)}`);
  
  try {
    // Cek BNB untuk gas
    const bnbBal = await provider.getBalance(signer.address);
    const bnbEth = parseFloat(ethers.utils.formatEther(bnbBal));
    if (bnbEth < 0.005) {
      console.warn('  ⚠️  BNB tidak cukup');
      return;
    }
    
    // Untuk versi awal: hanya simulasi
    // Eksekusi liquidation perlu:
    // 1. Approve USDT/asset ke vToken
    // 2. Panggil liquidateBorrow()
    // 3. Dapat collateral (vToken)
    // 4. Redeem ke underlying token
    // 5. Jual ke USDT
    // 6. Transfer profit ke ArbiBotTrade
    
    console.log('   📝 SIMULASI MODE — liquidation tidak dieksekusi');
    console.log('   ℹ️  Untuk aktifkan: uncomment baris executeLiquidation di main()');
    
    /* AKTIFKAN setelah test:
    
    const vToken = new ethers.Contract(opp.borrowedAsset, VTOKEN_ABI, signer);
    const underlying = await vToken.underlying();
    const tokenContract = new ethers.Contract(underlying, ERC20_ABI, signer);
    
    // Approve token ke vToken
    await tokenContract.approve(opp.borrowedAsset, opp.repayAmount);
    
    // Liquidate
    const tx = await vToken.liquidateBorrow(
      opp.borrower,
      opp.repayAmount,
      opp.collateralAsset,
      { gasLimit: 500000 }
    );
    const receipt = await tx.wait();
    console.log(`   ✅ TX: ${receipt.transactionHash.slice(0,20)}...`);
    
    totalLiquidations++;
    
    // Jual collateral dan transfer profit ke ArbiBotTrade
    // (implementasi tambahan)
    */
    
  } catch(e) {
    console.error('   ❌ Liquidation gagal:', e.message.slice(0,80));
  }
}

// ─────────────────────────────────────────────────────────
//  SCAN LOOP
// ─────────────────────────────────────────────────────────
async function scanAndLiquidate() {
  if (isRunning) return;
  isRunning = true;
  scanCount++;

  const now = new Date();
  const ts  = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

  try {
    if (CONFIG.WATCH_BORROWERS.length === 0) {
      console.log(`[${ts}] Scan #${scanCount} — Tidak ada borrower yang dipantau. Tambahkan ke WATCH_BORROWERS.`);
      isRunning = false;
      return;
    }
    
    process.stdout.write(`[${ts}] Scan #${scanCount} — checking ${CONFIG.WATCH_BORROWERS.length} borrowers... `);
    
    const opps = [];
    for (const borrower of CONFIG.WATCH_BORROWERS) {
      const opp = await checkBorrower(borrower);
      if (opp) opps.push(opp);
    }
    
    if (opps.length === 0) {
      console.log('semua sehat ✅');
    } else {
      console.log(`⚠️  ${opps.length} borrower BISA DI-LIQUIDATE!`);
      
      // Eksekusi yang shortfall terbesar dulu
      opps.sort((a,b) => b.shortfallUSD - a.shortfallUSD);
      
      for (const opp of opps.slice(0, 3)) {
        await executeLiquidation(opp);
      }
    }
    
  } catch(e) {
    console.error(`❌ Scanner error: ${e.message}`);
  }
  
  isRunning = false;
}

// ─────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────
async function start() {
  console.log(`\n🔄 Venus Liquidator aktif — interval ${CONFIG.SCAN_INTERVAL}s`);
  console.log(`📊 Min profit: $${CONFIG.MIN_PROFIT_USD}\n`);
  
  await scanAndLiquidate();
  setInterval(scanAndLiquidate, CONFIG.SCAN_INTERVAL * 1000);
}

init()
  .then(start)
  .catch(e => {
    console.error('❌ Fatal error:', e.message);
    process.exit(1);
  });
