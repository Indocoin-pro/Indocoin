// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║        INDOCOIN — POINT VAULT STAKING v2                     ║
 * ║  Program ID  : 9                                             ║
 * ║  Stake Token : INDC (BEP-20, decimal 9) — HANGUS             ║
 * ║  Reward      : POINT (Loyalty Rewards Program)               ║
 * ║                                                              ║
 * ║  Konversi  : $1 = 10,000 Point = Rp 10,000                   ║
 * ║  Rate      : 1%/hari dari nilai USD stake                    ║
 * ║  Min stake : $15 worth INDC (otomatis ikut harga)            ║
 * ║  Max stake : $1,500 worth INDC (otomatis ikut harga)         ║
 * ║  Max member: 1,000 orang                                     ║
 * ║                                                              ║
 * ║  DISCLAIMER: Point Vault adalah program loyalitas.           ║
 * ║  Point tidak memiliki nilai moneter langsung.                ║
 * ║  Penukaran point menjadi produk/layanan tergantung           ║
 * ║  ketersediaan katalog.                                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ── Interfaces ────────────────────────────────────────────────

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPriceOracle {
    function getIndcPrice() external view returns (uint256);
}

interface IPancakeRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);
}

interface IReferralMaster {
    function getUserInfo(address _user) external view returns (
        bool registered,
        address upline,
        uint256 joinTime,
        uint256 totalRefBonus,
        uint256 totalDownlineCount,
        uint8[] memory programs
    );
}

interface IAggregator {
    function reportVolumeINDC(address user, uint256 indcAmount, uint8 activityType) external;
}

// ── Contract ──────────────────────────────────────────────────

contract PointVaultStaking {

    // ── Hardcoded Addresses ───────────────────────────────────
    IERC20          public constant INDC            = IERC20(0xD772c96e1beFd2ea9C9a83182c71f4d32f306571);
    IERC20          public constant USDT_TOKEN      = IERC20(0x55d398326f99059fF775485246999027B3197955);
    IReferralMaster public constant REFERRAL_MASTER = IReferralMaster(0xde257f4C4fe50A650E7D7771ebe43a842CBE35D9);
    IAggregator     public constant AGGREGATOR      = IAggregator(0xD4109384EB4086E37265ec71f11e443269bf5110);
    address         public constant DEV_WALLET      = 0xa16E9579E19eB19e6E24B211121BdCD7996809Cc;

    // ── Constants ─────────────────────────────────────────────
    uint256 public constant INDC_DEC           = 1e9;
    uint256 public constant USDT_DEC           = 1e18;
    uint256 public constant RATE_PER_DAY       = 100;      // 1% = 100 BPS
    uint256 public constant BPS_BASE           = 10_000;
    uint256 public constant POINT_PER_USD      = 10_000;   // $1 = 10,000 Point
    uint256 public constant MIN_REDEEM         = 10_000;   // 10,000 Point = Rp 10,000
    uint256 public constant MAX_POINT_LIFETIME = 10_000_000; // max 10jt point seumur hidup
    uint256 public constant MAX_REDEEM_MONTHLY = 500_000;  // max 500,000 point/bulan
    uint256 public constant MAX_MEMBERS        = 1000;
    uint8   public constant PROGRAM_ID         = 9;

    // ── Stake berbasis USD (otomatis ikut harga INDC) ─────────
    uint256 public constant MIN_STAKE_USD  = 15   * USDT_DEC; // $15
    uint256 public constant MAX_STAKE_USD  = 1500 * USDT_DEC; // $1,500

    // ── Dana Jaminan (10% dari semua INDC masuk — TERKUNCI) ───
    uint256 public guaranteeFund;       // 10% terkunci
    uint256 public operationalFund;     // 90% untuk operasional

    // ── Timelock pool tutup (180 hari setelah deploy) ─────────
    uint256 public immutable POOL_CLOSE_TIMELOCK;

    // ── Harga & Kurs ──────────────────────────────────────────
    uint256 public indcPrice     = 3 * 1e15; // $0.003 dalam 18 desimal
    address public priceOracle   = address(0);
    address public pancakeRouter = address(0);
    uint256 public idrPerUsd     = 16000;    // Rp 16,000 per $1

    // ── Pool State ────────────────────────────────────────────
    bool    public poolOpen = true;
    uint256 public totalMembers;
    uint256 public totalIndcReceived;
    uint256 public totalPointIssued;

    // ── Bonus INDC Pool ───────────────────────────────────────
    uint256 public indcBonusPool;           // INDC tersedia untuk bonus
    uint256 public indcBonusRate = 20;      // 100,000 point = 20x rate = 2,000 INDC
    // Formula: indcAmount = (nominal / 100000) * indcBonusRate * INDC_DEC

    // ── Stake Info ────────────────────────────────────────────
    struct StakeInfo {
        uint256 indcAmount;
        uint256 usdValue;
        uint256 startTime;
        uint256 lastClaimTime;
        uint256 totalPointClaimed;
        bool    active;
    }

    mapping(address => StakeInfo) public stakes;

    // ── Point Balance ─────────────────────────────────────────
    mapping(address => uint256) public pointBalance;
    mapping(address => uint256) public totalPointEarned;
    mapping(address => uint256) public totalPointRedeemed;
    mapping(address => uint256) public monthlyRedeemed;
    mapping(address => uint256) public lastRedeemMonth;

    // ── Produk Katalog ────────────────────────────────────────

    struct Product {
        uint256 id;
        string  name;
        uint8   productType; // 1=Pulsa 2=Data 3=Listrik 4=BPJS 5=BonusINDC
        uint256 pointCost;
        uint256 pendingPointCost; // harga baru menunggu timelock
        uint256 priceUpdateTime;  // waktu harga baru berlaku
        bool    active;
    }

    mapping(uint256 => Product) public products;

    // ── Redeem Request ────────────────────────────────────────
    uint256 public redeemCount;

    enum RedeemStatus { PENDING, PROCESSED, REJECTED, AUTOCANCELLED }

    struct RedeemRequest {
        uint256      id;
        address      user;
        uint256      pointAmount;
        uint8        productType;
        string       destination;   // nomor HP / nomor meter / alamat pengiriman
        string       productCode;   // nama produk
        string       extraInfo;     // info tambahan: ukuran baju, varian, dll
        uint256      requestTime;
        uint256      autoCancelTime;
        RedeemStatus status;
        string       note;
    }

    mapping(uint256 => RedeemRequest) public redeemRequests;
    mapping(address => uint256[])     public userRedeemIds;

    // ── Reentrancy Guard ──────────────────────────────────────
    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "Reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    modifier onlyDev() {
        require(msg.sender == DEV_WALLET, "Bukan Dev");
        _;
    }

    modifier whenOpen() {
        require(poolOpen, "Pool tutup");
        _;
    }

    // ── Events ────────────────────────────────────────────────
    event Staked             (address indexed user, uint256 indcAmount, uint256 usdValue, uint256 pointPerDay);
    event PointClaimed       (address indexed user, uint256 pointAmount);
    event PointBonusAdded    (address indexed upline, address indexed from, uint256 pointAmount, uint8 level);
    event RedeemRequested    (address indexed user, uint256 redeemId, uint256 pointAmount, string productCode);
    event RedeemProcessed    (uint256 indexed redeemId, RedeemStatus status, string note);
    event RedeemAutoCancelled(uint256 indexed redeemId, address indexed user, uint256 pointReturned);
    event PriceUpdated       (uint256 newPrice);
    event IdrRateUpdated     (uint256 newRate);
    event BonusIndcProcessed  (address indexed user, uint256 redeemId, uint256 indcAmount);
    event BonusIndcTopUp      (uint256 amount);

    // ── Constructor ───────────────────────────────────────────
    constructor() {
        // Timelock pool tutup = 180 hari dari deploy
        POOL_CLOSE_TIMELOCK = block.timestamp + 180 days;
    }

    // ═══════════════════════════════════════════════════════════
    //  HARGA INDC — OTOMATIS
    // ═══════════════════════════════════════════════════════════

    function getIndcPrice() public view returns (uint256) {
        // Prioritas 1: PancakeSwap oracle
        if (pancakeRouter != address(0)) {
            address[] memory path = new address[](2);
            path[0] = address(INDC);
            path[1] = address(USDT_TOKEN);
            try IPancakeRouter(pancakeRouter).getAmountsOut(INDC_DEC, path)
                returns (uint256[] memory amounts) {
                if (amounts.length >= 2 && amounts[1] > 0)
                    return amounts[1];
            } catch {}
        }
        // Prioritas 2: Oracle eksternal
        if (priceOracle != address(0)) {
            try IPriceOracle(priceOracle).getIndcPrice() returns (uint256 p) {
                if (p > 0) return p;
            } catch {}
        }
        // Prioritas 3: Manual
        return indcPrice;
    }

    /**
     * @notice Konversi INDC ke USD — otomatis ikut harga
     */
    function indcToUsd(uint256 indcAmount) public view returns (uint256) {
        return (indcAmount * getIndcPrice()) / INDC_DEC;
    }

    /**
     * @notice Berapa INDC dibutuhkan untuk USD tertentu
     */
    function usdToIndc(uint256 usdAmount) public view returns (uint256) {
        uint256 price = getIndcPrice();
        require(price > 0, "Harga INDC nol");
        return (usdAmount * INDC_DEC) / price;
    }

    /**
     * @notice Batas min/max stake dalam INDC — otomatis ikut harga
     */
    function getStakeLimits() public view returns (uint256 minIndc, uint256 maxIndc) {
        minIndc = usdToIndc(MIN_STAKE_USD);
        maxIndc = usdToIndc(MAX_STAKE_USD);
    }

    // ═══════════════════════════════════════════════════════════
    //  HITUNG POINT
    // ═══════════════════════════════════════════════════════════

    function pendingPoint(address user) public view returns (uint256) {
        StakeInfo storage s = stakes[user];
        if (!s.active || s.usdValue == 0) return 0;

        uint256 elapsed     = block.timestamp - s.lastClaimTime;
        uint256 ppd         = _calcPointPerDay(s.usdValue);
        uint256 earned      = (ppd * elapsed) / 86400;

        // Cek max lifetime
        uint256 remaining = MAX_POINT_LIFETIME > s.totalPointClaimed
                            ? MAX_POINT_LIFETIME - s.totalPointClaimed : 0;
        return earned > remaining ? remaining : earned;
    }

    function _calcPointPerDay(uint256 usdValue) internal pure returns (uint256) {
        return (usdValue * RATE_PER_DAY * POINT_PER_USD) / (BPS_BASE * USDT_DEC);
    }

    // ── Bonus referral point — piramida turun ─────────────────
    function _refPointPct(uint8 level) internal pure returns (uint256) {
        if (level == 1)  return 300; // 3.0%
        if (level == 2)  return 200; // 2.0%
        if (level == 3)  return 100; // 1.0%
        if (level == 4)  return 50;  // 0.5%
        if (level == 5)  return 50;  // 0.5%
        if (level == 6)  return 30;  // 0.3%
        if (level == 7)  return 30;  // 0.3%
        if (level == 8)  return 20;  // 0.2%
        if (level == 9)  return 10;  // 0.1%
        if (level == 10) return 10;  // 0.1%
        return 0; // Total = 8%
    }

    function _distributeRefPoint(address user, uint256 pointAmount) internal {
        address current = user;
        for (uint8 i = 0; i < 10; i++) {
            (, address upline,,,,) = REFERRAL_MASTER.getUserInfo(current);
            if (upline == address(0)) break;
            uint8   level = i + 1;
            uint256 bonus = (pointAmount * _refPointPct(level)) / 10_000;
            if (bonus > 0) {
                pointBalance[upline]     += bonus;
                totalPointEarned[upline] += bonus;
                totalPointIssued         += bonus;
                emit PointBonusAdded(upline, user, bonus, level);
            }
            current = upline;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  STAKE
    // ═══════════════════════════════════════════════════════════

    function stake(uint256 indcAmount) external nonReentrant whenOpen {
        require(!stakes[msg.sender].active, "Sudah ada stake aktif");
        require(totalMembers < MAX_MEMBERS,  "Slot penuh");

        // Cek batas min/max otomatis berbasis USD
        (uint256 minIndc, uint256 maxIndc) = getStakeLimits();
        require(indcAmount >= minIndc, "Di bawah minimum stake");
        require(indcAmount <= maxIndc, "Di atas maksimum stake");

        // Cek registrasi ReferralMaster
        (bool registered,,,,, ) = REFERRAL_MASTER.getUserInfo(msg.sender);
        require(registered, "Daftar Referral Master dulu");

        // Hitung nilai USD
        uint256 usdVal = indcToUsd(indcAmount);
        require(usdVal > 0, "Nilai USD tidak valid");

        // Transfer INDC — HANGUS ke contract
        require(INDC.transferFrom(msg.sender, address(this), indcAmount), "Transfer gagal");

        // Alokasi dana: 10% jaminan, 90% operasional
        uint256 jaminan      = (indcAmount * 10) / 100;
        uint256 operasional  = indcAmount - jaminan;
        guaranteeFund       += jaminan;
        operationalFund     += operasional;
        totalIndcReceived   += indcAmount;
        totalMembers        += 1;

        uint256 ppd = _calcPointPerDay(usdVal);

        // Simpan stake
        stakes[msg.sender] = StakeInfo({
            indcAmount:        indcAmount,
            usdValue:          usdVal,
            startTime:         block.timestamp,
            lastClaimTime:     block.timestamp,
            totalPointClaimed: 0,
            active:            true
        });

        // Aggregator
        try AGGREGATOR.reportVolumeINDC(msg.sender, indcAmount, 2) {} catch {}

        emit Staked(msg.sender, indcAmount, usdVal, ppd);
    }

    // ═══════════════════════════════════════════════════════════
    //  CLAIM POINT
    // ═══════════════════════════════════════════════════════════

    function claimPoint() external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.active,   "Tidak ada stake aktif");

        uint256 earned = pendingPoint(msg.sender);
        require(earned > 0, "Belum ada point");

        // Update state DULU — CEI pattern
        s.lastClaimTime      = block.timestamp;
        s.totalPointClaimed += earned;

        pointBalance[msg.sender]    += earned;
        totalPointEarned[msg.sender]+= earned;
        totalPointIssued            += earned;

        // Distribusi bonus ke upline (piramida 10 level)
        _distributeRefPoint(msg.sender, earned);

        // Aggregator
        try AGGREGATOR.reportVolumeINDC(msg.sender, s.indcAmount, 1) {} catch {}

        emit PointClaimed(msg.sender, earned);
    }

    // ═══════════════════════════════════════════════════════════
    //  REDEEM
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice User request redeem — nominal bebas dari Digiflazz/Merchant
     * @param productType  1=Pulsa 2=Data 3=Listrik 4=BPJS 5=BonusINDC
     *                     6=ProdukFisik 7=Merchant 8=Voucher 9=Lainnya
     * @param nominal      Nilai dalam Rupiah (= jumlah point)
     * @param destination  Nomor HP / Nomor Meter / Alamat pengiriman
     * @param productName  Nama produk dari Digiflazz/Merchant
     * @param extraInfo    Info tambahan (ukuran, varian, dll)
     */
    function requestRedeem(
        uint8           productType,
        uint256         nominal,
        string calldata destination,
        string calldata productName,
        string calldata extraInfo
    ) external nonReentrant {
        require(productType >= 1 && productType <= 9, "Tipe produk tidak valid");
        require(nominal >= MIN_REDEEM,                "Di bawah minimum redeem");
        require(pointBalance[msg.sender] >= nominal,  "Point tidak cukup");
        require(bytes(destination).length > 0,        "Destination wajib diisi");

        // Cek max redeem bulanan
        _checkMonthlyLimit(msg.sender, nominal);

        // Potong point — CEI pattern
        pointBalance[msg.sender]       -= nominal;
        totalPointRedeemed[msg.sender] += nominal;

        redeemCount++;
        redeemRequests[redeemCount] = RedeemRequest({
            id:             redeemCount,
            user:           msg.sender,
            pointAmount:    nominal,
            productType:    productType,
            destination:    destination,
            productCode:    productName,
            extraInfo:      extraInfo,
            requestTime:    block.timestamp,
            autoCancelTime: block.timestamp + 72 hours,
            status:         RedeemStatus.PENDING,
            note:           ""
        });

        userRedeemIds[msg.sender].push(redeemCount);

        emit RedeemRequested(msg.sender, redeemCount, nominal, productName);
    }

    /**
     * @notice Auto-cancel redeem yang melewati 72 jam — bisa dipanggil siapapun
     */
    function autoCancelRedeem(uint256 redeemId) external nonReentrant {
        RedeemRequest storage r = redeemRequests[redeemId];
        require(r.id > 0,                          "Request tidak ada");
        require(r.status == RedeemStatus.PENDING,  "Sudah diproses");
        require(block.timestamp >= r.autoCancelTime, "Belum 72 jam");

        r.status = RedeemStatus.AUTOCANCELLED;

        // Kembalikan point ke user
        pointBalance[r.user]       += r.pointAmount;
        totalPointRedeemed[r.user] -= r.pointAmount;
        _refundMonthlyLimit(r.user, r.pointAmount);

        emit RedeemAutoCancelled(redeemId, r.user, r.pointAmount);
    }

    /**
     * @notice Dev proses redeem
     */
    function processRedeem(
        uint256         redeemId,
        bool            approved,
        string calldata note
    ) external onlyDev nonReentrant {
        RedeemRequest storage r = redeemRequests[redeemId];
        require(r.id > 0,                         "Request tidak ada");
        require(r.status == RedeemStatus.PENDING, "Sudah diproses");
        require(block.timestamp < r.autoCancelTime, "Sudah auto-cancel");

        if (approved) {
            r.status = RedeemStatus.PROCESSED;
        } else {
            r.status = RedeemStatus.REJECTED;
            // Kembalikan point kalau ditolak
            pointBalance[r.user]       += r.pointAmount;
            totalPointRedeemed[r.user] -= r.pointAmount;
            _refundMonthlyLimit(r.user, r.pointAmount);
        }
        r.note = note;

        emit RedeemProcessed(redeemId, r.status, note);
    }

    // ── Cek & update limit bulanan ────────────────────────────
    function _checkMonthlyLimit(address user, uint256 cost) internal {
        uint256 thisMonth = block.timestamp / 30 days;
        if (lastRedeemMonth[user] != thisMonth) {
            lastRedeemMonth[user]  = thisMonth;
            monthlyRedeemed[user]  = 0;
        }
        require(
            monthlyRedeemed[user] + cost <= MAX_REDEEM_MONTHLY,
            "Melebihi limit redeem bulanan"
        );
        monthlyRedeemed[user] += cost;
    }

    function _refundMonthlyLimit(address user, uint256 cost) internal {
        if (monthlyRedeemed[user] >= cost) {
            monthlyRedeemed[user] -= cost;
        }
    }



    // ═══════════════════════════════════════════════════════════
    //  BONUS INDC OTOMATIS
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Proses redeem Bonus INDC — otomatis transfer ke user
     *         Bisa dipanggil Dev ATAU user sendiri kalau productType == 5
     */
    function processRedeemBonusINDC(uint256 redeemId) external nonReentrant {
        RedeemRequest storage r = redeemRequests[redeemId];
        require(r.id > 0,                          "Request tidak ada");
        require(r.productType == 5,                "Bukan Bonus INDC");
        require(r.status == RedeemStatus.PENDING,  "Sudah diproses");
        require(block.timestamp < r.autoCancelTime, "Sudah auto-cancel");

        // Hitung INDC yang diterima user
        // Formula: (nominal / 100,000) * indcBonusRate * INDC_DEC
        uint256 indcAmount = (r.pointAmount * indcBonusRate * INDC_DEC) / 100_000;
        require(indcAmount > 0,               "INDC amount nol");
        require(indcBonusPool >= indcAmount,   "Stok Bonus INDC habis");

        // Update state DULU — CEI pattern
        r.status       = RedeemStatus.PROCESSED;
        r.note         = "Bonus INDC otomatis";
        indcBonusPool -= indcAmount;

        // Transfer INDC ke user
        require(INDC.transfer(r.user, indcAmount), "Transfer INDC gagal");

        emit BonusIndcProcessed(r.user, redeemId, indcAmount);
        emit RedeemProcessed(redeemId, RedeemStatus.PROCESSED, "Bonus INDC otomatis");
    }

    /**
     * @notice Dev topup INDC untuk pool bonus
     */
    function topUpBonusIndc(uint256 amount) external onlyDev nonReentrant {
        require(amount > 0, "Amount nol");
        require(INDC.transferFrom(msg.sender, address(this), amount), "Transfer gagal");
        indcBonusPool += amount;
        emit BonusIndcTopUp(amount);
    }

    /**
     * @notice Dev update rate bonus INDC
     * Contoh: rate=20 berarti 100,000 point = 2,000 INDC
     */
    function setIndcBonusRate(uint256 newRate) external onlyDev {
        require(newRate > 0, "Rate tidak valid");
        indcBonusRate = newRate;
    }

    // ═══════════════════════════════════════════════════════════
    //  DEV SETTINGS
    // ═══════════════════════════════════════════════════════════

    function setIndcPrice(uint256 newPrice) external onlyDev {
        require(newPrice > 0, "Harga tidak valid");
        indcPrice = newPrice;
        emit PriceUpdated(newPrice);
    }

    function setPancakeRouter(address router) external onlyDev {
        require(router != address(0), "Alamat tidak valid");
        pancakeRouter = router;
    }

    function setPriceOracle(address oracle) external onlyDev {
        priceOracle = oracle;
    }

    function setIdrRate(uint256 newRate) external onlyDev {
        require(newRate > 0, "Rate tidak valid");
        idrPerUsd = newRate;
        emit IdrRateUpdated(newRate);
    }

    function setPoolOpen(bool open) external onlyDev {
        if (!open) {
            // Tidak bisa tutup dalam 180 hari pertama
            require(
                block.timestamp >= POOL_CLOSE_TIMELOCK,
                "Pool tidak bisa ditutup dalam 180 hari"
            );
        }
        poolOpen = open;
    }

    /**
     * @notice Dev tarik dana operasional (90%) — bukan dana jaminan!
     */
    function withdrawOperational(uint256 amount) external onlyDev nonReentrant {
        require(amount > 0,                   "Amount nol");
        require(amount <= operationalFund,    "Melebihi dana operasional");
        operationalFund -= amount;
        require(INDC.transfer(DEV_WALLET, amount), "Transfer gagal");
    }

    /**
     * @notice User klaim dana jaminan jika Dev tidak aktif > 30 hari
     *         (tidak ada redeem yang diproses selama 30 hari)
     */
    function claimGuaranteeFund() external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.active, "Tidak ada stake aktif");

        // Cek apakah ada redeem user yang pending > 30 hari
        uint256[] storage ids = userRedeemIds[msg.sender];
        bool hasExpiredPending = false;
        for (uint256 i = 0; i < ids.length; i++) {
            RedeemRequest storage r = redeemRequests[ids[i]];
            if (r.status == RedeemStatus.PENDING &&
                block.timestamp >= r.requestTime + 30 days) {
                hasExpiredPending = true;
                break;
            }
        }
        require(hasExpiredPending, "Tidak ada redeem pending > 30 hari");

        // Hitung jaminan proporsional user
        uint256 userShare = (s.indcAmount * 10) / 100;
        require(guaranteeFund >= userShare, "Dana jaminan tidak cukup");

        guaranteeFund -= userShare;
        require(INDC.transfer(msg.sender, userShare), "Transfer gagal");
    }

    // ═══════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    function getUserStake(address user) external view returns (
        uint256 indcStaked,
        uint256 usdValue,
        uint256 pointPerDayEst,
        uint256 pendingPointNow,
        bool    active
    ) {
        StakeInfo storage s = stakes[user];
        indcStaked      = s.indcAmount;
        usdValue        = s.usdValue;
        pointPerDayEst  = s.active ? _calcPointPerDay(s.usdValue) : 0;
        pendingPointNow = pendingPoint(user);
        active          = s.active;
    }

    function getUserPoint(address user) external view returns (
        uint256 pointBal,
        uint256 totalEarned,
        uint256 totalRedeemed,
        uint256 monthlyUsed,
        uint256 monthlyLeft
    ) {
        uint256 thisMonth = block.timestamp / 30 days;
        uint256 used      = lastRedeemMonth[user] == thisMonth
                            ? monthlyRedeemed[user] : 0;
        pointBal      = pointBalance[user];
        totalEarned   = totalPointEarned[user];
        totalRedeemed = totalPointRedeemed[user];
        monthlyUsed   = used;
        monthlyLeft   = MAX_REDEEM_MONTHLY > used ? MAX_REDEEM_MONTHLY - used : 0;
    }

    function getPoolInfo() external view returns (
        uint256 members,
        uint256 maxMembers,
        uint256 indcReceived,
        uint256 indcBalance,
        uint256 opFund,
        uint256 guarFund,
        uint256 bonusPool,
        uint256 pointIssued,
        bool    open,
        uint256 currentPrice,
        uint256 idrRate,
        uint256 poolCloseLock
    ) {
        members       = totalMembers;
        maxMembers    = MAX_MEMBERS;
        indcReceived  = totalIndcReceived;
        indcBalance   = INDC.balanceOf(address(this));
        opFund        = operationalFund;
        guarFund      = guaranteeFund;
        bonusPool     = indcBonusPool;
        pointIssued   = totalPointIssued;
        open          = poolOpen;
        currentPrice  = getIndcPrice();
        idrRate       = idrPerUsd;
        poolCloseLock = POOL_CLOSE_TIMELOCK;
    }

    function getStakeLimitsInfo() external view returns (
        uint256 minUsd,
        uint256 maxUsd,
        uint256 minIndc,
        uint256 maxIndc,
        uint256 currentPrice
    ) {
        (uint256 mn, uint256 mx) = getStakeLimits();
        minUsd       = MIN_STAKE_USD;
        maxUsd       = MAX_STAKE_USD;
        minIndc      = mn;
        maxIndc      = mx;
        currentPrice = getIndcPrice();
    }



    function getRedeemRequest(uint256 redeemId) external view returns (
        uint256       id,
        address       user,
        uint256       pointAmount,
        uint8         productType,
        string memory destination,
        string memory productCode,
        string memory extraInfo,
        uint256       requestTime,
        uint256       autoCancelTime,
        uint8         status,
        string memory note
    ) {
        RedeemRequest storage r = redeemRequests[redeemId];
        id             = r.id;
        user           = r.user;
        pointAmount    = r.pointAmount;
        productType    = r.productType;
        destination    = r.destination;
        productCode    = r.productCode;
        extraInfo      = r.extraInfo;
        requestTime    = r.requestTime;
        autoCancelTime = r.autoCancelTime;
        status         = uint8(r.status);
        note           = r.note;
    }

    function getUserRedeems(address user) external view returns (uint256[] memory) {
        return userRedeemIds[user];
    }

    /**
     * @notice Helper — nama kategori dari productType
     * Frontend ambil katalog dari Digiflazz API + Merchant backend
     * Contract hanya validasi tipe 1-9
     */
    function getProductTypeName(uint8 productType) external pure returns (string memory) {
        if (productType == 1) return "Pulsa";
        if (productType == 2) return "Paket Data";
        if (productType == 3) return "Token Listrik";
        if (productType == 4) return "BPJS";
        if (productType == 5) return "Bonus INDC";
        if (productType == 6) return "Produk Fisik";
        if (productType == 7) return "Merchant Partner";
        if (productType == 8) return "Voucher Digital";
        return "Lainnya";
    }

    /**
     * @notice Helper — apakah produk butuh alamat pengiriman
     * Untuk frontend menampilkan form yang tepat
     */
    function needsDeliveryAddress(uint8 productType) external pure returns (bool) {
        // Produk fisik dan merchant partner butuh alamat
        return productType == 6 || productType == 7;
    }

    /**
     * @notice Helper — apakah produk digital (proses cepat)
     */
    function isDigitalProduct(uint8 productType) external pure returns (bool) {
        return productType == 1 || productType == 2 ||
               productType == 3 || productType == 4 ||
               productType == 5 || productType == 8;
    }

    function estimatePointPerDay(uint256 indcAmount) external view returns (
        uint256 ppd,
        uint256 usdVal,
        uint256 idrVal,
        uint256 minStakeIndc,
        uint256 maxStakeIndc
    ) {
        usdVal           = indcToUsd(indcAmount);
        ppd              = _calcPointPerDay(usdVal);
        idrVal           = ppd;
        (minStakeIndc, maxStakeIndc) = getStakeLimits();
    }
}
