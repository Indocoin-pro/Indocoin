require("dotenv").config();
const { ethers } = require('ethers');
const fs = require('fs');

// ─────────────────────────────────────────────────────────
//  VENUS + MULTI LIQUIDATION BOT — INDOCOIN
//  Monitor & eksekusi liquidation di Venus, Radiant, dll
//  Auto-indexing borrower dari blockchain
//  Profit otomatis ke ArbiBotTrade → dibagi ke user
// ─────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL       : 'https://bsc.publicnode.com',
  RPC_BACKUP    : 'https://binance.llamarpc.com',
  RPC_BACKUP2   : 'https://bsc-rpc.publicnode.com',
  PRIVATE_KEY   : process.env.BOT_PRIVATE_KEY || 'ISI_PRIVATE_KEY_BOT_DISINI',

  ARBIBOT_TRADE : '0x4C37CAD6909305274373803b88f4D2ab5162f259',

  // Venus Protocol BSC
  VENUS: {
    COMPTROLLER : '0xfD36E2c2a6789Db23113685031d7F16329158384',
    VTOKENS: [
      { name: 'vBNB',  address: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', decimals: 8  },
      { name: 'vUSDT', address: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', decimals: 8  },
      { name: 'vBUSD', address: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D', decimals: 8  },
      { name: 'vBTC',  address: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B', decimals: 8  },
      { name: 'vETH',  address: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8', decimals: 8  },
      { name: 'vUSDC', address: '0xeCA88125a5ADbe82614ffC12D0DB554E2e2867C8', decimals: 8  },
      { name: 'vCAKE', address: '0x86aC3974e2BD0d60825230fa6F355fF11409df5c', decimals: 8  },
    ],
    LIQUIDATION_BONUS : 0.10,
    CLOSE_FACTOR      : 0.5,
  },

  USDT          : '0x55d398326f99059fF775485246999027B3197955',
  WBNB          : '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  PANCAKE_ROUTER: '0x10ED43C718714eb63d5aA57B78B54704E256024E',

  // Setting
  MIN_PROFIT_USD     : 5,
  MAX_REPAY_USD      : 1000,
  SCAN_INTERVAL      : 15,         // detik — cek health factor
  INDEX_INTERVAL     : 3600,       // detik — scan borrower baru tiap 1 jam
  INDEX_BLOCKS_BACK  : 300000,     // ~ 10 hari blok BSC
  BORROWER_FILE      : '/root/indocoin/venus-borrowers.json',
  EXECUTE_MODE       : false,      // false = simulasi (aman), true = eksekusi real
};

// ─────────────────────────────────────────────────────────
//  ABIs
// ─────────────────────────────────────────────────────────
const COMPTROLLER_ABI = [
  'function getAccountLiquidity(address) view returns (uint256, uint256, uint256)',
  'function getAssetsIn(address) view returns (address[])',
  'function markets(address) view returns (bool, uint256, bool)',
];

const VTOKEN_ABI = [
  'function borrowBalanceStored(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function underlying() view returns (address)',
  'function liquidateBorrow(address borrower, uint256 repayAmount, address vTokenCollateral) returns (uint256)',
  'event Borrow(address borrower, uint256 borrowAmount, uint256 accountBorrows, uint256 totalBorrows)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

const ARBIBOT_ABI = [
  'function distributeProfit(address user, uint256 grossProfit) external',
];

// ─────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────
let provider, signer, comptroller, arbibotTrade;
let borrowers = new Set();
let scanCount = 0;
let totalLiquidations = 0;
let totalProfit = 0;
let lastIndexTime = 0;

// ─────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────
async function init() {
  console.log('💧 Venus Liquidation Bot — INDOCOIN (Auto-Indexer)');
  console.log('═'.repeat(55));

  const rpcs = [CONFIG.RPC_URL, CONFIG.RPC_BACKUP, CONFIG.RPC_BACKUP2];
  for (const rpc of rpcs) {
    try {
      provider = new ethers.providers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      console.log(`✅ Connected to: ${rpc}`);
      break;
    } catch(e) {
      console.log(`❌ RPC gagal: ${rpc}`);
    }
  }
  if (!provider) throw new Error('Semua RPC gagal');

  signer       = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  comptroller  = new ethers.Contract(CONFIG.VENUS.COMPTROLLER, COMPTROLLER_ABI, signer);
  arbibotTrade = new ethers.Contract(CONFIG.ARBIBOT_TRADE, ARBIBOT_ABI, signer);

  console.log('🔑 Bot wallet:', signer.address);
  console.log('💰 Profit ke:', CONFIG.ARBIBOT_TRADE);
  console.log('🎯 Mode:', CONFIG.EXECUTE_MODE ? '🔴 LIVE EXECUTION' : '🟢 SIMULASI');

  const bnbBal = await provider.getBalance(signer.address);
  console.log(`⛽ BNB: ${parseFloat(ethers.utils.formatEther(bnbBal)).toFixed(6)}`);

  // Load borrower dari file kalau ada
  loadBorrowers();
  console.log(`📋 Borrower terdaftar: ${borrowers.size}`);
}

// ─────────────────────────────────────────────────────────
//  LOAD & SAVE BORROWER LIST
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
//  AUTO-INDEXER: Scan event Borrow dari Venus
// ─────────────────────────────────────────────────────────
async function indexBorrowers() {
  console.log('\n🔍 Indexing borrower dari blockchain...');
  
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - CONFIG.INDEX_BLOCKS_BACK;
    
    let newCount = 0;
    
    // Scan event Borrow di setiap vToken
    for (const vTokenInfo of CONFIG.VENUS.VTOKENS) {
      try {
        const vToken = new ethers.Contract(vTokenInfo.address, VTOKEN_ABI, provider);
        
        // Filter event Borrow
        const filter = vToken.filters.Borrow();
        
        // Scan dalam chunks 5000 blok agar tidak timeout
        const chunkSize = 1000;
        for (let start = fromBlock; start < currentBlock; start += chunkSize) {
          const end = Math.min(start + chunkSize, currentBlock);
          
          try {
            const events = await vToken.queryFilter(filter, start, end);
            
            for (const ev of events) {
              const addr = ev.args.borrower.toLowerCase();
              if (!borrowers.has(addr)) {
                borrowers.add(addr);
                newCount++;
              }
            }
          } catch(e) {
            // Skip chunk yang error
          }
        }
        
        console.log(`   ${vTokenInfo.name}: total ${borrowers.size} borrower`);
        
      } catch(e) {
        console.log(`   ${vTokenInfo.name}: error ${e.message.slice(0,40)}`);
      }
    }
    
    saveBorrowers();
    console.log(`✅ Indexing selesai: ${newCount} borrower baru | Total: ${borrowers.size}`);
    lastIndexTime = Date.now();
    
  } catch(e) {
    console.error('❌ Indexing error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────
//  CEK HEALTH FACTOR
// ─────────────────────────────────────────────────────────
async function checkBorrower(borrower) {
  try {
    const [err, liquidity, shortfall] = await comptroller.getAccountLiquidity(borrower);
    
    if (err.toNumber() !== 0) return null;
    if (shortfall.eq(0)) return null;
    
    const shortfallUSD = parseFloat(ethers.utils.formatUnits(shortfall, 18));
    if (shortfallUSD < CONFIG.MIN_PROFIT_USD) return null;

    // Cari asset untuk liquidate
    const assetsIn = await comptroller.getAssetsIn(borrower);
    
    let borrowedAsset = null, collateralAsset = null;
    let maxBorrow = ethers.BigNumber.from(0);
    let maxCollateral = ethers.BigNumber.from(0);
    
    for (const vToken of assetsIn) {
      const v = new ethers.Contract(vToken, VTOKEN_ABI, provider);
      const borrow = await v.borrowBalanceStored(borrower);
      const balance = await v.balanceOf(borrower);
      
      if (borrow.gt(maxBorrow)) { maxBorrow = borrow; borrowedAsset = vToken; }
      if (balance.gt(maxCollateral)) { maxCollateral = balance; collateralAsset = vToken; }
    }
    
    if (!borrowedAsset || !collateralAsset) return null;
    
    return {
      borrower,
      shortfallUSD,
      borrowedAsset,
      collateralAsset,
      maxBorrow,
      repayAmount: maxBorrow.mul(50).div(100),
      estimatedBonus: shortfallUSD * CONFIG.VENUS.LIQUIDATION_BONUS,
    };
    
  } catch(e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
//  EKSEKUSI LIQUIDATION
// ─────────────────────────────────────────────────────────
async function executeLiquidation(opp) {
  console.log('\n⚡ LIQUIDATION OPPORTUNITY');
  console.log(`   Borrower    : ${opp.borrower.slice(0,10)}...`);
  console.log(`   Shortfall   : $${opp.shortfallUSD.toFixed(2)}`);
  console.log(`   Est. Bonus  : $${opp.estimatedBonus.toFixed(2)}`);
  
  if (!CONFIG.EXECUTE_MODE) {
    console.log('   📝 SIMULASI MODE — set EXECUTE_MODE=true untuk eksekusi');
    return;
  }
  
  try {
    const bnbBal = await provider.getBalance(signer.address);
    if (parseFloat(ethers.utils.formatEther(bnbBal)) < 0.005) {
      console.warn('   ⚠️  BNB tidak cukup');
      return;
    }
    
    const vToken = new ethers.Contract(opp.borrowedAsset, VTOKEN_ABI, signer);
    const underlying = await vToken.underlying();
    const tokenContract = new ethers.Contract(underlying, ERC20_ABI, signer);
    
    // Cek saldo & approve
    const balance = await tokenContract.balanceOf(signer.address);
    if (balance.lt(opp.repayAmount)) {
      console.warn(`   ⚠️  Saldo token tidak cukup`);
      return;
    }
    
    await (await tokenContract.approve(opp.borrowedAsset, opp.repayAmount)).wait();
    
    // Liquidate
    const tx = await vToken.liquidateBorrow(
      opp.borrower,
      opp.repayAmount,
      opp.collateralAsset,
      { gasLimit: 600000 }
    );
    
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      console.log(`   ✅ SUCCESS! TX: ${receipt.transactionHash.slice(0,20)}...`);
      totalLiquidations++;
      
      // TODO: Redeem collateral, jual ke USDT, transfer ke ArbiBotTrade
      // Sederhana: hitung collateral yang diterima
    } else {
      console.log(`   ❌ TX failed`);
    }
    
  } catch(e) {
    console.error('   ❌ Liquidation gagal:', e.message.slice(0,80));
  }
}

// ─────────────────────────────────────────────────────────
//  SCAN LOOP
// ─────────────────────────────────────────────────────────
async function scanAndLiquidate() {
  scanCount++;
  
  const now = new Date();
  const ts  = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

  // Re-index borrower setiap 1 jam
  if (Date.now() - lastIndexTime > CONFIG.INDEX_INTERVAL * 1000) {
    await indexBorrowers();
  }
  
  if (borrowers.size === 0) {
    console.log(`[${ts}] Scan #${scanCount} — Belum ada borrower terindeks`);
    return;
  }
  
  process.stdout.write(`[${ts}] Scan #${scanCount} — checking ${borrowers.size} borrowers... `);
  
  const opps = [];
  const borrowerArr = [...borrowers];
  
  // Cek paralel dalam batch 20 untuk lebih cepat
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
  
  console.log(`📊 Stats: ${totalLiquidations} liquidations | Total profit: $${totalProfit.toFixed(2)}`);
}

// ─────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────
async function start() {
  // Index pertama kali
  if (borrowers.size === 0) {
    await indexBorrowers();
  } else {
    lastIndexTime = Date.now();
  }
  
  console.log(`\n🔄 Venus Liquidator aktif — scan interval ${CONFIG.SCAN_INTERVAL}s\n`);
  
  await scanAndLiquidate();
  setInterval(scanAndLiquidate, CONFIG.SCAN_INTERVAL * 1000);
}

init()
  .then(start)
  .catch(e => {
    console.error('❌ Fatal:', e.message);
    process.exit(1);
  });
