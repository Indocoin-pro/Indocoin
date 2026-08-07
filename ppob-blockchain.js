/**
 * blockchain.js
 * Interaksi ke smart contract PPOBGateway — dengarkan event OrderCreated,
 * dan lapor balik status (reportOrderSuccess/reportOrderFailed) memakai
 * wallet Backend Operator.
 */

const { ethers } = require('ethers');
require('dotenv').config();

const PPOB_GATEWAY_ABI = [
  'event OrderCreated(bytes32 indexed orderId, address indexed user, bytes32 indexed productCode, uint8 method, uint256 amountPaid, uint256 modalUsdt, uint256 profitUsdt)',
  'event OrderSucceeded(bytes32 indexed orderId)',
  'event OrderRefunded(bytes32 indexed orderId, bool byTimeout)',
  'function reportOrderSuccess(bytes32 orderId) external',
  'function reportOrderFailed(bytes32 orderId) external',
  'function getOrder(bytes32 orderId) external view returns (tuple(address user, bytes32 productCode, uint8 method, uint256 amountPaid, uint256 modalUsdt, uint256 profitUsdt, uint8 status, uint256 createdAt))',
  'function paused() external view returns (bool)',
];

const PAYMENT_METHOD = { 0: 'USDT', 1: 'PLATFORM_INDC', 2: 'EXTERNAL_INDC' };
const ORDER_STATUS = { 0: 'CREATED', 1: 'SUCCESS', 2: 'REFUNDED' };

// staticNetwork: BSC Mainnet (chainId 56) — dipatri langsung supaya ethers
// tidak mengirim request tambahan (eth_chainId + net_version) tiap kali
// provider dibuat, mengurangi risiko kena rate limit RPC publik.
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, {
  chainId: 56,
  name: 'bnb',
}, { staticNetwork: true });
const backendWallet = new ethers.Wallet(process.env.BACKEND_OPERATOR_PRIVATE_KEY, provider);

const contract = new ethers.Contract(
  process.env.PPOB_GATEWAY_ADDRESS,
  PPOB_GATEWAY_ABI,
  backendWallet
);

/** Ubah string kode produk (misal "TSEL5") jadi bytes32 untuk on-chain */
function encodeProductCode(str) {
  return ethers.encodeBytes32String(str);
}

/** Kebalikannya — baca bytes32 dari event jadi string biasa */
function decodeProductCode(bytes32Value) {
  try {
    return ethers.decodeBytes32String(bytes32Value);
  } catch {
    return null; // kalau kosong/tidak valid
  }
}

/**
 * Dengarkan event OrderCreated secara real-time.
 * @param {Function} onOrderCreated  callback(orderData)
 */
function listenForOrders(onOrderCreated) {
  contract.on('OrderCreated', (orderId, user, productCodeBytes, method, amountPaid, modalUsdt, profitUsdt, event) => {
    onOrderCreated({
      orderId,
      user,
      productCode: decodeProductCode(productCodeBytes),
      method: PAYMENT_METHOD[method] || 'UNKNOWN',
      amountPaid,
      modalUsdt,
      profitUsdt,
      txHash: event.log.transactionHash,
    });
  });

  console.log('[blockchain.js] Mendengarkan event OrderCreated dari', process.env.PPOB_GATEWAY_ADDRESS);
}

/**
 * Ambil ulang riwayat event dari rentang blok tertentu — dipakai saat
 * listener baru start/restart, supaya order yang terjadi selagi backend
 * offline tetap tertangkap (bukan cuma event yang terjadi setelah listen
 * dimulai).
 */
async function getPastOrders(fromBlock) {
  const currentBlock = await provider.getBlockNumber();
  const events = await contract.queryFilter('OrderCreated', fromBlock, currentBlock);

  return events.map((event) => ({
    orderId: event.args.orderId,
    user: event.args.user,
    productCode: decodeProductCode(event.args.productCode),
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
    productCode: decodeProductCode(order.productCode),
    method: PAYMENT_METHOD[order.method],
    amountPaid: order.amountPaid,
    modalUsdt: order.modalUsdt,
    profitUsdt: order.profitUsdt,
    status: ORDER_STATUS[order.status],
    createdAt: Number(order.createdAt),
  };
}

/**
 * Lapor sukses ke kontrak. Dana didistribusikan (modal ke Operational
 * Wallet, profit ke 4 vault) OTOMATIS oleh kontrak setelah ini dipanggil.
 */
async function reportSuccess(orderId) {
  const tx = await contract.reportOrderSuccess(orderId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Lapor gagal — kontrak otomatis refund penuh ke user. */
async function reportFailed(orderId) {
  const tx = await contract.reportOrderFailed(orderId);
  const receipt = await tx.wait();
  return receipt.hash;
}

async function isPaused() {
  return contract.paused();
}

module.exports = {
  contract,
  provider,
  listenForOrders,
  getPastOrders,
  getOnchainOrder,
  reportSuccess,
  reportFailed,
  isPaused,
  encodeProductCode,
  decodeProductCode,
};
