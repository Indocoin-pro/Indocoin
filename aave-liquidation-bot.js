require("dotenv").config();
const { ethers } = require('ethers');
const fs = require('fs');

// ─────────────────────────────────────────────────────────
//  AAVE V3 LIQUIDATION BOT — INDOCOIN
//  Liquidation di Aave Protocol BSC
//  Auto-indexing borrower dari blockchain
//  Profit otomatis ke ArbiBotTrade → user
// ─────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL       : 'https://bsc.publicnode.com',
  RPC_BACKUP    : 'https://binance.llamarpc.com',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',

  ARBIBOT_TRADE     : '0x4C37CAD6909305274373803b88f4D2ab5162f259',
  AAVE_LIQUIDATOR   : '0xeffcdb5df0783c6802331f0b7067931152b19bb1',

  // Aave V3 BSC Addresses
  AAVE_POOL         : '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
  POOL_ADDR_PROVIDER: '0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D',
  DATA_PROVIDER     : '0x41585C50524fb8c3899B43D7D797d9486AAc94DB',

  // Token assets di Aave V3 BSC
  ASSETS: [
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955' },
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
    { symbol: 'BTCB', address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c' },
    { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
    { symbol: 'ETH',  address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' },
  ],

  // Setting
  MIN_HEALTH_FACTOR : 1.0,
  MIN_PROFIT_USD    : 5,
  SCAN_INTERVAL     : 15,         // detik
  INDEX_INTERVAL    : 3600,       // re-index tiap 1 jam
  INDEX_BLOCKS_BACK : 300000,     // ~10 hari blok BSC
  BORROWER_FILE     : '/root/indocoin/aave-borrowers.json',
  EXECUTE_MODE      : false,      // false = simulasi
};

const DATA_PROVIDER_ABI = [
  'function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)',
];

const POOL_ABI = [
  'function getUserAccountData(address) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getUserConfiguration(address) view returns (tuple(uint256 data))',
  'function getReservesList() view returns (address[])',
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
];

const LIQUIDATOR_ABI = [
  'function executeLiquidation(address collateral, address debt, address user, uint256 debtToCover, address topUser) external',
];

const ARBIBOT_ABI = [
  'function getTopUser() view returns (address)',
];

let provider, signer, pool, dataProvider, liquidator, arbibotTrade;
let borrowers = new Set();
let scanCount = 0;
let totalLiquidations = 0;
let lastIndexTime = 0;

async function init() {
  console.log('💎 Aave V3 Liquidation Bot — INDOCOIN');
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
  pool = new ethers.Contract(CONFIG.AAVE_POOL, POOL_ABI, signer);
  dataProvider = new ethers.Contract(CONFIG.DATA_PROVIDER, DATA_PROVIDER_ABI, signer);
  arbibotTrade = new ethers.Contract(CONFIG.ARBIBOT_TRADE, ARBIBOT_ABI, signer);
  
  if (CONFIG.AAVE_LIQUIDATOR !== 'BELUM_DEPLOY') {
    liquidator = new ethers.Contract(CONFIG.AAVE_LIQUIDATOR, LIQUIDATOR_ABI, signer);
  }

  console.log('🔑 Bot wallet:', signer.address);
  console.log('🏦 Aave Pool:', CONFIG.AAVE_POOL);
  console.log('💰 Profit ke:', CONFIG.ARBIBOT_TRADE);
  console.log('⚡ Liquidator:', CONFIG.AAVE_LIQUIDATOR);
  console.log('🎯 Mode:', CONFIG.EXECUTE_MODE ? '🔴 LIVE' : '🟢 SIMULASI');

  const bnb = await provider.getBalance(signer.address);
  console.log(`⛽ BNB: ${parseFloat(ethers.utils.formatEther(bnb)).toFixed(6)}`);

  loadBorrowers();
  console.log(`📋 Borrower terdaftar: ${borrowers.size}\n`);
}

function loadBorrowers() {
  try {
    if (fs.existsSync(CONFIG.BORROWER_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.BORROWER_FILE, 'utf-8'));
      borrowers = new Set(data);
    }
  } catch(e) {}
}

function saveBorrowers() {
  try {
    fs.writeFileSync(CONFIG.BORROWER_FILE, JSON.stringify([...borrowers], null, 2));
  } catch(e) {}
}

async function indexBorrowers() {
  console.log('\n🔍 Indexing Aave borrower dari blockchain...');

  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - CONFIG.INDEX_BLOCKS_BACK;
    let newCount = 0;

    const filter = pool.filters.Borrow();
    const chunkSize = 1000;

    for (let start = fromBlock; start < currentBlock; start += chunkSize) {
      const end = Math.min(start + chunkSize, currentBlock);
      try {
        const events = await pool.queryFilter(filter, start, end);
        for (const ev of events) {
          const addr = ev.args.onBehalfOf.toLowerCase();
          if (!borrowers.has(addr)) {
            borrowers.add(addr);
            newCount++;
          }
        }
      } catch(e) {}
    }

    saveBorrowers();
    console.log(`✅ Indexing selesai: ${newCount} borrower baru | Total: ${borrowers.size}`);
    lastIndexTime = Date.now();

  } catch(e) {
    console.error('❌ Indexing error:', e.message);
  }
}

async function checkBorrower(borrower) {
  try {
    const data = await pool.getUserAccountData(borrower);
    
    const healthFactor = parseFloat(ethers.utils.formatUnits(data.healthFactor, 18));
    
    if (healthFactor >= CONFIG.MIN_HEALTH_FACTOR) return null;
    if (data.totalDebtBase.eq(0)) return null;
    
    const debtUSD = parseFloat(ethers.utils.formatUnits(data.totalDebtBase, 8));
    const collateralUSD = parseFloat(ethers.utils.formatUnits(data.totalCollateralBase, 8));
    
    if (debtUSD < CONFIG.MIN_PROFIT_USD) return null;

    // Estimasi bonus (rata-rata 7.5% di Aave V3 BSC)
    const estimatedBonus = debtUSD * 0.075 * 0.5; // 50% close factor
    
    // Cari collateral asset terbesar & debt asset terbesar
    let bestCollateral = null, bestDebt = null;
    let maxCollateralBal = ethers.BigNumber.from(0);
    let maxDebtBal = ethers.BigNumber.from(0);
    
    for (const asset of CONFIG.ASSETS) {
      try {
        const r = await dataProvider.getUserReserveData(asset.address, borrower);
        
        if (r.currentATokenBalance.gt(maxCollateralBal) && r.usageAsCollateralEnabled) {
          maxCollateralBal = r.currentATokenBalance;
          bestCollateral = asset.address;
        }
        
        const totalDebt = r.currentStableDebt.add(r.currentVariableDebt);
        if (totalDebt.gt(maxDebtBal)) {
          maxDebtBal = totalDebt;
          bestDebt = asset.address;
        }
      } catch(e) {}
    }
    
    if (!bestCollateral || !bestDebt) return null;

    return {
      borrower,
      healthFactor,
      debtUSD,
      collateralUSD,
      estimatedBonus,
      collateralAsset: bestCollateral,
      debtAsset: bestDebt,
      debtToCover: maxDebtBal.div(2), // 50% close factor
    };

  } catch(e) {
    return null;
  }
}

async function executeLiquidation(opp) {
  console.log('\n⚡ LIQUIDATION OPPORTUNITY');
  console.log(`   Borrower    : ${opp.borrower.slice(0,10)}...`);
  console.log(`   Health      : ${opp.healthFactor.toFixed(4)}`);
  console.log(`   Hutang      : $${opp.debtUSD.toFixed(2)}`);
  console.log(`   Collateral  : $${opp.collateralUSD.toFixed(2)}`);
  console.log(`   Est. Bonus  : $${opp.estimatedBonus.toFixed(2)}`);

  if (!CONFIG.EXECUTE_MODE) {
    console.log('   📝 SIMULASI');
    return;
  }

  if (!liquidator) {
    console.warn('   ⚠️  AaveLiquidator contract belum di-deploy');
    return;
  }

  try {
    const bnb = await provider.getBalance(signer.address);
    if (parseFloat(ethers.utils.formatEther(bnb)) < 0.005) {
      console.warn('   ⚠️  BNB tidak cukup');
      return;
    }

    // Eksekusi via AaveLiquidator contract
    // Butuh: collateralAsset, debtAsset, user, debtToCover
    // Untuk simpel: ambil asset terbesar
    // Catatan: implementasi lengkap perlu cek reserve user
    
    let topUser = '0x0000000000000000000000000000000000000000';
    try { topUser = await arbibotTrade.getTopUser(); } catch(e) {}
    
    console.log('   📡 Mengirim TX...');
    
    const tx = await liquidator.executeLiquidation(
      opp.collateralAsset,
      opp.debtAsset,
      opp.borrower,
      opp.debtToCover,
      topUser,
      { gasLimit: 1500000 }
    );
    
    console.log(`   TX: ${tx.hash.slice(0,20)}...`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log(`   ✅ SUCCESS!`);
      totalLiquidations++;
    } else {
      console.log(`   ❌ Revert`);
    }
    
  } catch(e) {
    console.error('   ❌ Gagal:', e.message.slice(0,80));
  }
}

async function scan() {
  scanCount++;
  const now = new Date();
  const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

  if (Date.now() - lastIndexTime > CONFIG.INDEX_INTERVAL * 1000) {
    await indexBorrowers();
  }

  if (borrowers.size === 0) {
    console.log(`[${ts}] Scan #${scanCount} — Belum ada borrower`);
    return;
  }

  process.stdout.write(`[${ts}] Scan #${scanCount} — checking ${borrowers.size} borrowers... `);

  const opps = [];
  const borrowerArr = [...borrowers];
  const batchSize = 20;

  for (let i = 0; i < borrowerArr.length; i += batchSize) {
    const batch = borrowerArr.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(b => checkBorrower(b)));
    results.forEach(r => { if (r) opps.push(r); });
  }

  if (opps.length === 0) {
    console.log('semua sehat ✅');
  } else {
    console.log(`⚠️  ${opps.length} bisa di-liquidate!`);
    opps.sort((a,b) => b.estimatedBonus - a.estimatedBonus);
    for (const opp of opps.slice(0, 3)) {
      await executeLiquidation(opp);
    }
  }

  console.log(`📊 Stats: ${totalLiquidations} liquidations`);
}

async function start() {
  if (borrowers.size === 0) {
    await indexBorrowers();
  } else {
    lastIndexTime = Date.now();
  }

  console.log(`\n🔄 Aave Liquidator aktif — scan interval ${CONFIG.SCAN_INTERVAL}s\n`);
  await scan();
  setInterval(scan, CONFIG.SCAN_INTERVAL * 1000);
}

init()
  .then(start)
  .catch(e => { console.error('Fatal:', e.message); process.exit(1); });
