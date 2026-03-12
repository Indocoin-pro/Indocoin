// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════╗
 * ║           INDOCOIN — INDC STAKING CONTRACT           ║
 * ║                                                      ║
 * ║  Paket A : 2% / hari | Lock s/d 30 Mei 2026         ║
 * ║  Paket B : 1% / hari | Request USDT harian           ║
 * ║                                                      ║
 * ║  Token   : INDC (BEP-20, decimal 9)                 ║
 * ║  Network : BNB Smart Chain (BSC)                     ║
 * ╚══════════════════════════════════════════════════════╝
 */

interface IERC20 {
    function totalSupply()                                           external view returns (uint256);
    function balanceOf(address account)                             external view returns (uint256);
    function transfer(address to, uint256 amount)                   external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender)              external view returns (uint256);
    function approve(address spender, uint256 amount)               external returns (bool);
}

contract INDCStaking {

    // ─────────────────────────────────────────────
    //  CONSTANTS & IMMUTABLES
    // ─────────────────────────────────────────────

    IERC20  public immutable indc;

    uint256 public constant INDC_DEC     = 9;
    uint256 public constant INDC_UNIT    = 10 ** INDC_DEC;

    // 30 Mei 2026 00:00:00 UTC
    uint256 public constant LOCK_END     = 1748563200;

    // Paket A: 2%/hari = 200 BPS
    uint256 public constant RATE_A       = 200;
    // Paket B: 1%/hari = 100 BPS
    uint256 public constant RATE_B       = 100;
    uint256 public constant BPS          = 10_000;

    uint256 public constant MIN_STAKE    = 1_000  * INDC_UNIT;
    uint256 public constant MAX_STAKE_A  = 50_000 * INDC_UNIT;
    uint256 public constant MAX_STAKE_B  = 25_000 * INDC_UNIT;

    // Min request ~334 INDC = $1 USDT (1 / 0.003)
    uint256 public constant MIN_REQ_INDC = 334 * INDC_UNIT;
    uint256 public constant REQ_INTERVAL = 1 days;

    // ─────────────────────────────────────────────
    //  STATE
    // ─────────────────────────────────────────────

    address public owner;
    address public devWallet;

    bool public pausedA;
    bool public pausedB;

    uint256 public totalStakedA;
    uint256 public totalStakedB;

    // ─────────────────────────────────────────────
    //  STRUCTS
    // ─────────────────────────────────────────────

    struct StakeA {
        uint256 amount;
        uint256 since;
        bool    claimed;
    }

    struct StakeB {
        uint256 amount;
        uint256 since;
        uint256 rewardClaimed;
        uint256 lastRequest;
        bool    unstaked;
    }

    struct Request {
        uint256 indcAmount;
        uint256 usdtMillis;   // USDT * 1000 (untuk presisi tanpa float)
        uint256 timestamp;
        bool    approved;
    }

    // ─────────────────────────────────────────────
    //  MAPPINGS
    // ─────────────────────────────────────────────

    mapping(address => StakeA)    public stakesA;
    mapping(address => StakeB)    public stakesB;
    mapping(address => Request[]) public requests;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    event StakedA          (address indexed user, uint256 amount, uint256 timestamp);
    event ClaimedA         (address indexed user, uint256 principal, uint256 reward);
    event StakedB          (address indexed user, uint256 amount, uint256 timestamp);
    event UnstakedB        (address indexed user, uint256 amount);
    event RequestedUSDT    (address indexed user, uint256 indcAmount, uint256 reqIndex);
    event ApprovedRequest  (address indexed dev,  address indexed user, uint256 reqIndex);
    event RewardFunded     (address indexed funder, uint256 amount);
    event DevWalletUpdated (address indexed oldDev, address indexed newDev);
    event OwnerTransferred (address indexed oldOwner, address indexed newOwner);

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Bukan owner");
        _;
    }

    modifier onlyDev() {
        require(msg.sender == devWallet || msg.sender == owner, "Bukan dev");
        _;
    }

    modifier notPausedA() { require(!pausedA, "Paket A dijeda"); _; }
    modifier notPausedB() { require(!pausedB, "Paket B dijeda"); _; }

    modifier lockEnded() {
        require(block.timestamp >= LOCK_END, "Lock belum berakhir: 30 Mei 2026");
        _;
    }

    // ─────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────

    constructor(address _indc, address _devWallet) {
        require(_indc      != address(0), "Address INDC invalid");
        require(_devWallet != address(0), "Address Dev invalid");
        indc      = IERC20(_indc);
        devWallet = _devWallet;
        owner     = msg.sender;
    }

    // ═════════════════════════════════════════════
    //  PAKET A  —  2% / hari
    // ═════════════════════════════════════════════

    /**
     * @notice Stake INDC ke Paket A (min 1.000, max 50.000)
     */
    function stakePaketA(uint256 amount) external notPausedA {
        require(block.timestamp < LOCK_END,       "Periode stake sudah tutup");
        require(amount >= MIN_STAKE,              "Min stake 1.000 INDC");
        require(amount <= MAX_STAKE_A,            "Max stake 50.000 INDC");
        require(stakesA[msg.sender].amount == 0,  "Sudah ada stake Paket A aktif");

        require(indc.transferFrom(msg.sender, address(this), amount), "Transfer gagal");

        stakesA[msg.sender] = StakeA({ amount: amount, since: block.timestamp, claimed: false });
        totalStakedA += amount;

        emit StakedA(msg.sender, amount, block.timestamp);
    }

    /**
     * @notice Claim principal + reward Paket A — hanya setelah 30 Mei 2026
     */
    function claimPaketA() external lockEnded {
        StakeA storage s = stakesA[msg.sender];
        require(s.amount > 0,  "Tidak ada stake Paket A");
        require(!s.claimed,    "Sudah pernah claim");

        uint256 principal = s.amount;
        uint256 reward    = _rewardA(msg.sender);
        uint256 total     = principal + reward;

        s.claimed     = true;
        totalStakedA -= principal;

        require(indc.transfer(msg.sender, total), "Transfer gagal");

        emit ClaimedA(msg.sender, principal, reward);
    }

    function _rewardA(address user) internal view returns (uint256) {
        StakeA storage s = stakesA[user];
        if (s.amount == 0 || s.claimed) return 0;
        uint256 cap  = block.timestamp < LOCK_END ? block.timestamp : LOCK_END;
        uint256 days_ = (cap - s.since) / 1 days;
        return (s.amount * RATE_A * days_) / BPS;
    }

    function pendingRewardA(address user) external view returns (uint256) {
        return _rewardA(user);
    }

    // ═════════════════════════════════════════════
    //  PAKET B  —  1% / hari + Request USDT
    // ═════════════════════════════════════════════

    /**
     * @notice Stake INDC ke Paket B (min 1.000, max 25.000)
     */
    function stakePaketB(uint256 amount) external notPausedB {
        require(block.timestamp < LOCK_END,       "Periode stake sudah tutup");
        require(amount >= MIN_STAKE,              "Min stake 1.000 INDC");
        require(amount <= MAX_STAKE_B,            "Max stake 25.000 INDC");
        require(stakesB[msg.sender].amount == 0,  "Sudah ada stake Paket B aktif");

        require(indc.transferFrom(msg.sender, address(this), amount), "Transfer gagal");

        stakesB[msg.sender] = StakeB({
            amount        : amount,
            since         : block.timestamp,
            rewardClaimed : 0,
            lastRequest   : 0,
            unstaked      : false
        });
        totalStakedB += amount;

        emit StakedB(msg.sender, amount, block.timestamp);
    }

    /**
     * @notice Request tukar reward INDC → USDT (1x per hari, min ~334 INDC)
     * @param indcAmount Jumlah INDC reward yang ingin dijual ke Dev
     */
    function requestUSDT(uint256 indcAmount) external notPausedB {
        StakeB storage s = stakesB[msg.sender];
        require(s.amount > 0,                                          "Tidak ada stake Paket B");
        require(!s.unstaked,                                           "Sudah unstake");
        require(indcAmount >= MIN_REQ_INDC,                            "Min request ~334 INDC");
        require(block.timestamp >= s.lastRequest + REQ_INTERVAL,       "Hanya 1x request per hari");

        uint256 available = _availableB(msg.sender);
        require(indcAmount <= available,                               "Reward tidak cukup");

        // Update state dulu (CEI pattern — cegah reentrancy)
        s.rewardClaimed += indcAmount;
        s.lastRequest    = block.timestamp;

        // usdtMillis: indcAmount * 0.003 * 1000 = indcAmount * 3 / INDC_UNIT
        uint256 usdtMillis = (indcAmount * 3) / INDC_UNIT;

        requests[msg.sender].push(Request({
            indcAmount : indcAmount,
            usdtMillis : usdtMillis,
            timestamp  : block.timestamp,
            approved   : false
        }));

        uint256 idx = requests[msg.sender].length - 1;

        // Kirim INDC ke wallet Dev
        require(indc.transfer(devWallet, indcAmount), "Transfer ke Dev gagal");

        emit RequestedUSDT(msg.sender, indcAmount, idx);
    }

    /**
     * @notice Dev approve request — update status on-chain
     *         (pengiriman USDT dilakukan manual off-chain oleh Dev)
     */
    function approveRequest(address user, uint256 reqIndex) external onlyDev {
        require(reqIndex < requests[user].length, "Index tidak valid");
        Request storage r = requests[user][reqIndex];
        require(!r.approved, "Sudah diapprove");

        r.approved = true;

        emit ApprovedRequest(msg.sender, user, reqIndex);
    }

    /**
     * @notice Approve banyak request sekaligus (batch)
     */
    function approveRequestBatch(address[] calldata users, uint256[] calldata idxs) external onlyDev {
        require(users.length == idxs.length, "Panjang array tidak sama");
        for (uint256 i = 0; i < users.length; i++) {
            if (idxs[i] < requests[users[i]].length && !requests[users[i]][idxs[i]].approved) {
                requests[users[i]][idxs[i]].approved = true;
                emit ApprovedRequest(msg.sender, users[i], idxs[i]);
            }
        }
    }

    /**
     * @notice Unstake modal Paket B — hanya setelah 30 Mei 2026
     */
    function unstakePaketB() external lockEnded {
        StakeB storage s = stakesB[msg.sender];
        require(s.amount > 0,  "Tidak ada stake Paket B");
        require(!s.unstaked,   "Sudah unstake");

        uint256 principal = s.amount;
        s.unstaked    = true;
        totalStakedB -= principal;

        require(indc.transfer(msg.sender, principal), "Transfer gagal");

        emit UnstakedB(msg.sender, principal);
    }

    // ─────────────────────────────────────────────
    //  VIEW — REWARD PAKET B
    // ─────────────────────────────────────────────

    function _totalEarnedB(address user) internal view returns (uint256) {
        StakeB storage s = stakesB[user];
        if (s.amount == 0) return 0;
        uint256 cap   = block.timestamp < LOCK_END ? block.timestamp : LOCK_END;
        uint256 days_ = (cap - s.since) / 1 days;
        return (s.amount * RATE_B * days_) / BPS;
    }

    function _availableB(address user) internal view returns (uint256) {
        uint256 earned  = _totalEarnedB(user);
        uint256 claimed = stakesB[user].rewardClaimed;
        return earned > claimed ? earned - claimed : 0;
    }

    function totalEarnedB(address user)   external view returns (uint256) { return _totalEarnedB(user); }
    function availableRewardB(address user) external view returns (uint256) { return _availableB(user); }

    // ─────────────────────────────────────────────
    //  VIEW — DASHBOARD
    // ─────────────────────────────────────────────

    function getStakePaketA(address user) external view returns (
        uint256 amount, uint256 since, uint256 reward, bool claimed, bool canClaim
    ) {
        StakeA storage s = stakesA[user];
        amount   = s.amount;
        since    = s.since;
        reward   = _rewardA(user);
        claimed  = s.claimed;
        canClaim = !s.claimed && s.amount > 0 && block.timestamp >= LOCK_END;
    }

    function getStakePaketB(address user) external view returns (
        uint256 amount, uint256 since, uint256 pendingReward,
        uint256 rewardClaimed, uint256 lastRequest,
        bool unstaked, bool canUnstake, bool canRequest
    ) {
        StakeB storage s = stakesB[user];
        amount        = s.amount;
        since         = s.since;
        pendingReward = _availableB(user);
        rewardClaimed = s.rewardClaimed;
        lastRequest   = s.lastRequest;
        unstaked      = s.unstaked;
        canUnstake    = !s.unstaked && s.amount > 0 && block.timestamp >= LOCK_END;
        canRequest    = !s.unstaked && s.amount > 0
                        && block.timestamp >= s.lastRequest + REQ_INTERVAL
                        && _availableB(user) >= MIN_REQ_INDC;
    }

    function getRequests(address user)     external view returns (Request[] memory) { return requests[user]; }
    function getRequestCount(address user) external view returns (uint256)          { return requests[user].length; }

    function getContractStats() external view returns (
        uint256 _totalStakedA, uint256 _totalStakedB,
        uint256 _balance, uint256 _lockEnd,
        bool _pausedA, bool _pausedB
    ) {
        _totalStakedA = totalStakedA;
        _totalStakedB = totalStakedB;
        _balance      = indc.balanceOf(address(this));
        _lockEnd      = LOCK_END;
        _pausedA      = pausedA;
        _pausedB      = pausedB;
    }

    // ─────────────────────────────────────────────
    //  ADMIN
    // ─────────────────────────────────────────────

    /// @notice Deposit INDC sebagai reward pool
    function fundRewardPool(uint256 amount) external onlyOwner {
        require(amount > 0, "Jumlah harus > 0");
        require(indc.transferFrom(msg.sender, address(this), amount), "Transfer gagal");
        emit RewardFunded(msg.sender, amount);
    }

    function setDevWallet(address newDev) external onlyOwner {
        require(newDev != address(0), "Address invalid");
        emit DevWalletUpdated(devWallet, newDev);
        devWallet = newDev;
    }

    function setPauseA(bool _pause) external onlyOwner { pausedA = _pause; }
    function setPauseB(bool _pause) external onlyOwner { pausedB = _pause; }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Address invalid");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Tarik sisa INDC — hanya setelah lock berakhir
    function emergencyWithdraw(uint256 amount) external onlyOwner lockEnded {
        require(indc.transfer(owner, amount), "Transfer gagal");
    }
}
