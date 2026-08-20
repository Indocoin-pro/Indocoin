/**
 * ppob-topup.js
 * Interaksi ke smart contract TopUpVault — kontrak TERPISAH dari
 * PPOBGateway, khusus fitur "Top Up USDT pakai Rupiah/QRIS". Sengaja
 * dipisah filenya (bukan digabung ke blockchain.js) supaya jelas kalau
 * ini pakai wallet backend operator YANG BEDA (TOPUP_BACKEND_OPERATOR_
 * PRIVATE_KEY), bukan wallet operator PPOB.
 */

const { ethers } = require('ethers');
require('dotenv').config();

const TOPUP_VAULT_ABI = [
  'function executeTopUp(bytes32 topupId, address user, uint256 usdtAmount) external',
  'function isExecuted(bytes32 topupId) external view returns (bool)',
  'function vaultBalance() external view returns (uint256)',
  'function paused() external view returns (bool)',
  'event TopUpExecuted(bytes32 indexed topupId, address indexed user, uint256 usdtSent, uint256 timestamp)',
];

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, {
  chainId: 56,
  name: 'bnb',
}, { staticNetwork: true });

const topupWallet = new ethers.Wallet(process.env.TOPUP_BACKEND_OPERATOR_PRIVATE_KEY, provider);

const contract = new ethers.Contract(
  process.env.TOPUP_VAULT_ADDRESS,
  TOPUP_VAULT_ABI,
  topupWallet
);

/**
 * Kirim USDT ke wallet user lewat TopUpVault, setelah admin konfirmasi
 * manual bahwa pembayaran Rupiah/QRIS sudah masuk.
 * @param {string} topupId    bytes32 hex string, ID unik permintaan top up
 * @param {string} walletUser alamat wallet tujuan
 * @param {number} usdtAmount jumlah USDT (angka biasa, mis. 5.97), SUDAH dipotong fee
 * @returns {Promise<string>} tx hash
 */
async function executeTopUp(topupId, walletUser, usdtAmount) {
  const usdtAmountWei = ethers.parseUnits(usdtAmount.toFixed(18), 18);
  const tx = await contract.executeTopUp(topupId, walletUser, usdtAmountWei);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Cek saldo USDT yang tersisa di vault — dipakai panel admin */
async function getVaultBalance() {
  const balWei = await contract.vaultBalance();
  return parseFloat(ethers.formatUnits(balWei, 18));
}

/** Cek apakah topupId ini sudah pernah dieksekusi on-chain (anti dobel) */
async function isExecuted(topupId) {
  return contract.isExecuted(topupId);
}

module.exports = {
  executeTopUp,
  getVaultBalance,
  isExecuted,
};
