/**
 * ecommerce-blockchain.js
 * Interaksi ke smart contract EcommerceGateway — dengarkan event
 * OrderCreated, dan panggil fungsi admin (startProcessing/reportOrderSuccess/
 * rejectOrder/dll) memakai wallet Backend Operator / Admin.
 */

const { ethers } = require('ethers');
require('dotenv').config();

const ECOMMERCE_GATEWAY_ABI = [
  'event OrderCreated(bytes32 indexed orderId, address indexed user, bytes32 indexed orderRef, uint8 method, uint256 amountPaid, uint256 modalUsdt, uint256 profitUsdt)',
  'event OrderProcessing(bytes32 indexed orderId, bool isCOD)',
  'event OrderSucceeded(bytes32 indexed orderId)',
  'event OrderRefunded(bytes32 indexed orderId, string reason)',
  'event OrderCancelled(bytes32 indexed orderId)',
  'event CODConfirmedReceived(bytes32 indexed orderId)',
  'event CODConfirmedRejected(bytes32 indexed orderId)',
  'function startProcessing(bytes32 orderId, bool isCOD) external',
  'function rejectOrder(bytes32 orderId) external',
  'function reportOrderSuccess(bytes32 orderId) external',
  'function reportOrderFailed(bytes32 orderId) external',
  'function getOrder(bytes32 orderId) external view returns (tuple(address user, bytes32 orderRef, uint8 method, uint256 amountPaid, uint256 modalUsdt, uint256 profitUsdt, uint8 status, bool isCOD, bool modalReleased, uint256 createdAt, uint256 processingAt))',
  'function getProcessingElapsed(bytes32 orderId) external view returns (uint256)',
  'function paused() external view returns (bool)',
  'function maxOrderTotalUsdt() external view returns (uint256)',
  'function maxActiveOrdersPerWallet() external view returns (uint256)',
  'function activeOrderCount(address) external view returns (uint256)',
  'function getRedemptionVaultStatus() external view returns (uint256 available, uint256 reserved)',
  'function getPoolStatus() external view returns (uint256 buybackPending, uint256 burnPending, uint256 nextBuybackThreshold, uint256 nextBurnThreshold)',
  'function isAdmin(address) external view returns (bool)',
  'function owner() external view returns (address)',
];

const PAYMENT_METHOD = { 0: 'USDT', 1: 'PLATFORM_INDC', 2: 'EXTERNAL_INDC' };
const ORDER_STATUS = { 0: 'CREATED', 1: 'PROCESSING', 2: 'SUCCESS', 3: 'REFUNDED', 4: 'CANCELLED' };

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, {
  chainId: 56,
  name: 'bnb',
}, { staticNetwork: true });

const backendWallet = new ethers.Wallet(process.env.BACKEND_OPERATOR_PRIVATE_KEY, provider);

const contract = new ethers.Contract(
  process.env.ECOMMERCE_GATEWAY_ADDRESS,
  ECOMMERCE_GATEWAY_ABI,
  backendWallet
);

// ─────────────────────────────────────────────────────────────────
// LISTENER — event OrderCreated (order baru masuk, perlu admin review)
// ─────────────────────────────────────────────────────────────────

function listenForOrders(onOrderCreated) {
  contract.on('OrderCreated', (orderId, user, orderRef, method, amountPaid, modalUsdt, profitUsdt, event) => {
    onOrderCreated({
      orderId,
      user,
      orderRef,
      method: PAYMENT_METHOD[method] || 'UNKNOWN',
      amountPaid,
      modalUsdt,
      profitUsdt,
      txHash: event.log.transactionHash,
    });
  });

  console.log('[ecommerce-blockchain.js] Mendengarkan event OrderCreated dari', process.env.ECOMMERCE_GATEWAY_ADDRESS);
}

/** Dengarkan juga konfirmasi COD dari buyer (received/rejected) — dua-duanya
 * dipicu buyer sendiri, backend perlu tahu buat update status internal &
 * kasih tahu admin (misal buat catatan/audit, bukan buat aksi dana — dana
 * sudah otomatis diproses kontrak). */
function listenForCODConfirmations(onCODReceived, onCODRejected) {
  contract.on('CODConfirmedReceived', (orderId, event) => {
    onCODReceived({ orderId, txHash: event.log.transactionHash });
  });
  contract.on('CODConfirmedRejected', (orderId, event) => {
    onCODRejected({ orderId, txHash: event.log.transactionHash });
  });
}

/** Ambil ulang riwayat event dari rentang blok tertentu — dipakai saat
 * listener baru start/restart, supaya order yang masuk selagi backend
 * offline tetap tertangkap. */
async function getPastOrders(fromBlock) {
  const currentBlock = await provider.getBlockNumber();
  const events = await contract.queryFilter('OrderCreated', fromBlock, currentBlock);

  return events.map((event) => ({
    orderId: event.args.orderId,
    user: event.args.user,
    orderRef: event.args.orderRef,
    method: PAYMENT_METHOD[event.args.method] || 'UNKNOWN',
    amountPaid: event.args.amountPaid,
    modalUsdt: event.args.modalUsdt,
    profitUsdt: event.args.profitUsdt,
    txHash: event.transactionHash,
  }));
}

async function getOnchainOrder(orderId) {
  const order = await contract.getOrder(orderId);
  return {
    user: order.user,
    orderRef: order.orderRef,
    method: PAYMENT_METHOD[order.method],
    amountPaid: order.amountPaid,
    modalUsdt: order.modalUsdt,
    profitUsdt: order.profitUsdt,
    status: ORDER_STATUS[order.status],
    isCOD: order.isCOD,
    modalReleased: order.modalReleased,
    createdAt: Number(order.createdAt),
    processingAt: Number(order.processingAt),
  };
}

// ─────────────────────────────────────────────────────────────────
// AKSI ADMIN
// ─────────────────────────────────────────────────────────────────

/**
 * Admin mulai proses order (mulai belanja di Shopee/Tokopedia).
 * @param {boolean} isCOD  true kalau produk cuma sedia opsi COD.
 * Non-COD: modal langsung cair ke Operational Wallet di titik ini.
 */
async function startProcessing(orderId, isCOD) {
  const tx = await contract.startProcessing(orderId, isCOD);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Admin tolak order — HANYA selagi status masih CREATED. Refund penuh otomatis. */
async function rejectOrder(orderId) {
  const tx = await contract.rejectOrder(orderId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Lapor sukses (non-COD) — fee cair ke 4 pool. Modal sudah cair sejak startProcessing. */
async function reportSuccess(orderId) {
  const tx = await contract.reportOrderSuccess(orderId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Lapor gagal SETELAH modal sudah cair (mis. stok ternyata habis). Refund fee saja ke user. */
async function reportFailed(orderId) {
  const tx = await contract.reportOrderFailed(orderId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Berapa lama order sudah di status PROCESSING (detik) — buat trigger alert 6/12 jam. */
async function getProcessingElapsedSeconds(orderId) {
  const elapsed = await contract.getProcessingElapsed(orderId);
  return Number(elapsed);
}

async function isPaused() {
  return contract.paused();
}

async function getLimits() {
  const [maxOrderTotalUsdt, maxActiveOrdersPerWallet] = await Promise.all([
    contract.maxOrderTotalUsdt(),
    contract.maxActiveOrdersPerWallet(),
  ]);
  return {
    maxOrderTotalUsdt: Number(ethers.formatUnits(maxOrderTotalUsdt, 18)),
    maxActiveOrdersPerWallet: Number(maxActiveOrdersPerWallet),
  };
}

async function getActiveOrderCount(userAddress) {
  const count = await contract.activeOrderCount(userAddress);
  return Number(count);
}

async function getRedemptionVaultStatus() {
  const [available, reserved] = await contract.getRedemptionVaultStatus();
  return {
    available: Number(ethers.formatUnits(available, 18)),
    reserved: Number(ethers.formatUnits(reserved, 18)),
  };
}

async function getPoolStatus() {
  const [buybackPending, burnPending, nextBuybackThreshold, nextBurnThreshold] = await contract.getPoolStatus();
  return {
    buybackPending: Number(ethers.formatUnits(buybackPending, 18)),
    burnPending: Number(ethers.formatUnits(burnPending, 18)),
    nextBuybackThreshold: Number(ethers.formatUnits(nextBuybackThreshold, 18)),
    nextBurnThreshold: Number(ethers.formatUnits(nextBurnThreshold, 18)),
  };
}

module.exports = {
  contract,
  listenForOrders,
  listenForCODConfirmations,
  getPastOrders,
  getOnchainOrder,
  startProcessing,
  rejectOrder,
  reportSuccess,
  reportFailed,
  getProcessingElapsedSeconds,
  isPaused,
  getLimits,
  getActiveOrderCount,
  getRedemptionVaultStatus,
  getPoolStatus,
  PAYMENT_METHOD,
  ORDER_STATUS,
};
