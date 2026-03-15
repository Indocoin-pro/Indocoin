// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          INDOCOIN — PAID AD SPACE CONTRACT v2                ║
 * ║                                                              ║
 * ║  Fitur  : Pendaftaran Iklan · Banner Dashboard               ║
 * ║  Token  : INDC (BEP-20, decimal 9)                          ║
 * ║  Network: BNB Smart Chain (BSC)                              ║
 * ║                                                              ║
 * ║  Alur:                                                       ║
 * ║  1. Pengiklan registerAd() → fee langsung ke devWallet       ║
 * ║  2. Iklan aktif 1 tahun                                      ║
 * ║  3. Pengiklan renewAd() untuk perpanjang                     ║
 * ║  4. Opsional: registerBanner() tampil di dashboard           ║
 * ║  5. Admin bisa suspend/unsuspend kapan saja                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

interface IERC20 {
    function balanceOf(address account)                             external view returns (uint256);
    function transfer(address to, uint256 amount)                   external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract IndocoinPaidAds {

    // ─────────────────────────────────────────────
    //  CONSTANTS
    // ─────────────────────────────────────────────

    IERC20  public immutable indc;

    uint256 public constant INDC_UNIT       = 10 ** 9;
    uint256 public constant MAX_SLOTS       = 100;
    uint256 public constant MAX_BANNERS     = 20;
    uint256 public constant AD_DURATION     = 365 days;
    uint256 public constant BANNER_DURATION = 30 days;
    uint256 public constant EXPIRE_WARN     = 7 days;

    // Biaya pendaftaran tahunan
    uint256 public constant FEE_UMKM    = 1_825_000 * INDC_UNIT;
    uint256 public constant FEE_UD      = 3_650_000 * INDC_UNIT;
    uint256 public constant FEE_CV      = 10_950_000 * INDC_UNIT;
    uint256 public constant FEE_PT      = 18_250_000 * INDC_UNIT;

    // Biaya desain banner
    uint256 public constant DESIGN_UMKM = 10_000  * INDC_UNIT;
    uint256 public constant DESIGN_UD   = 20_000  * INDC_UNIT;
    uint256 public constant DESIGN_CV   = 30_000  * INDC_UNIT;
    uint256 public constant DESIGN_PT   = 50_000  * INDC_UNIT;

    // Biaya banner dashboard per bulan
    uint256 public constant BANNER_UMKM = 150_000 * INDC_UNIT;
    uint256 public constant BANNER_UD   = 300_000 * INDC_UNIT;
    uint256 public constant BANNER_CV   = 500_000 * INDC_UNIT;
    uint256 public constant BANNER_PT   = 750_000 * INDC_UNIT;

    // ─────────────────────────────────────────────
    //  ENUMS & STRUCTS
    // ─────────────────────────────────────────────

    enum Category { UMKM, UD, CV, PT }

    struct Advertiser {
        address  wallet;
        Category category;
        uint256  registeredAt;
        uint256  expiresAt;
        bool     active;
        bool     suspended;
        uint256  adId;
    }

    struct BannerSlot {
        address advertiser;
        uint256 startTime;
        uint256 endTime;
        bool    active;
    }

    // ─────────────────────────────────────────────
    //  STATE
    // ─────────────────────────────────────────────

    address public owner;
    address public devWallet;
    bool    public paused;

    uint256 public activeSlots;
    uint256 public nextAdId;
    uint256 public totalRevenue;

    mapping(uint256 => Advertiser) public advertisers;
    mapping(address => uint256)    public sellerAdId;

    BannerSlot[20] public bannerSlots;
    address[]      public bannerWaitlist;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    event AdRegistered(uint256 indexed adId, address indexed seller, Category category, uint256 fee, uint256 expiresAt);
    event AdRenewed   (uint256 indexed adId, address indexed seller, uint256 newExpiry);
    event AdExpired   (uint256 indexed adId, address indexed seller);
    event AdSuspended (uint256 indexed adId, address indexed seller, string reason);
    event AdUnsuspended(uint256 indexed adId, address indexed seller);

    event BannerRegistered  (address indexed advertiser, uint256 slotIdx, uint256 endTime);
    event AddedToWaitlist   (address indexed advertiser, uint256 position);
    event RemovedFromWaitlist(address indexed advertiser);

    event DevWalletChanged(address indexed oldWallet, address indexed newWallet);
    event ContractPaused(bool status);

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────

    modifier onlyOwner()  { require(msg.sender == owner, "not owner"); _; }
    modifier notPaused()  { require(!paused, "paused"); _; }

    modifier onlyActiveSeller() {
        uint256 id = sellerAdId[msg.sender];
        require(id != 0,                        "not registered");
        require(advertisers[id].active,         "ad not active");
        require(!advertisers[id].suspended,     "ad suspended");
        require(block.timestamp < advertisers[id].expiresAt, "ad expired");
        _;
    }

    // ─────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────

    constructor(address _indcToken, address _devWallet) {
        require(_indcToken != address(0), "zero token");
        require(_devWallet != address(0), "zero devWallet");
        indc      = IERC20(_indcToken);
        owner     = msg.sender;
        devWallet = _devWallet;
        nextAdId  = 1;
    }

    // ─────────────────────────────────────────────
    //  A. PENDAFTARAN IKLAN
    // ─────────────────────────────────────────────

    /**
     * @notice Daftar iklan baru
     * @param category   0=UMKM 1=UD 2=CV 3=PT
     * @param wantDesign true jika minta desain banner dari tim Indocoin
     */
    function registerAd(Category category, bool wantDesign) external notPaused {
        require(activeSlots < MAX_SLOTS,      "slots full");
        require(sellerAdId[msg.sender] == 0,  "already registered");

        uint256 total = _regFee(category) + (wantDesign ? _designFee(category) : 0);

        require(indc.transferFrom(msg.sender, devWallet, total), "transfer failed");
        totalRevenue += total;

        uint256 adId   = nextAdId++;
        uint256 expiry = block.timestamp + AD_DURATION;

        advertisers[adId] = Advertiser({
            wallet       : msg.sender,
            category     : category,
            registeredAt : block.timestamp,
            expiresAt    : expiry,
            active       : true,
            suspended    : false,
            adId         : adId
        });

        sellerAdId[msg.sender] = adId;
        activeSlots++;

        emit AdRegistered(adId, msg.sender, category, total, expiry);
    }

    /**
     * @notice Perpanjang iklan 1 tahun lagi
     */
    function renewAd() external notPaused {
        uint256 adId = sellerAdId[msg.sender];
        require(adId != 0,                    "not registered");
        require(!advertisers[adId].suspended, "suspended");

        Advertiser storage ad = advertisers[adId];
        uint256 fee = _regFee(ad.category);

        require(indc.transferFrom(msg.sender, devWallet, fee), "transfer failed");
        totalRevenue += fee;

        uint256 base  = block.timestamp > ad.expiresAt ? block.timestamp : ad.expiresAt;
        ad.expiresAt  = base + AD_DURATION;

        if (!ad.active) { ad.active = true; activeSlots++; }

        emit AdRenewed(adId, msg.sender, ad.expiresAt);
    }

    // ─────────────────────────────────────────────
    //  B. BANNER DASHBOARD
    // ─────────────────────────────────────────────

    /**
     * @notice Daftar banner dashboard (max 20 slot, 30 hari)
     * Jika slot penuh → masuk daftar tunggu otomatis
     */
    function registerBanner() external notPaused onlyActiveSeller {
        uint256 fee = _bannerFee(advertisers[sellerAdId[msg.sender]].category);

        // Cari slot kosong
        int256 emptySlot = -1;
        for (uint256 i = 0; i < MAX_BANNERS; i++) {
            if (!bannerSlots[i].active || block.timestamp > bannerSlots[i].endTime) {
                emptySlot = int256(i);
                break;
            }
        }

        if (emptySlot >= 0) {
            require(indc.transferFrom(msg.sender, devWallet, fee), "banner fee failed");
            totalRevenue += fee;

            uint256 idx = uint256(emptySlot);
            bannerSlots[idx] = BannerSlot({
                advertiser : msg.sender,
                startTime  : block.timestamp,
                endTime    : block.timestamp + BANNER_DURATION,
                active     : true
            });

            emit BannerRegistered(msg.sender, idx, block.timestamp + BANNER_DURATION);
        } else {
            for (uint256 i = 0; i < bannerWaitlist.length; i++) {
                require(bannerWaitlist[i] != msg.sender, "already in waitlist");
            }
            bannerWaitlist.push(msg.sender);
            emit AddedToWaitlist(msg.sender, bannerWaitlist.length);
        }
    }

    /**
     * @notice Keluar dari daftar tunggu banner
     */
    function leaveWaitlist() external {
        for (uint256 i = 0; i < bannerWaitlist.length; i++) {
            if (bannerWaitlist[i] == msg.sender) {
                for (uint256 j = i; j < bannerWaitlist.length - 1; j++) {
                    bannerWaitlist[j] = bannerWaitlist[j + 1];
                }
                bannerWaitlist.pop();
                emit RemovedFromWaitlist(msg.sender);
                return;
            }
        }
        revert("not in waitlist");
    }

    // ─────────────────────────────────────────────
    //  C. ADMIN
    // ─────────────────────────────────────────────

    function suspendAd(uint256 adId, string calldata reason) external onlyOwner {
        require(advertisers[adId].wallet != address(0), "not exist");
        advertisers[adId].suspended = true;
        emit AdSuspended(adId, advertisers[adId].wallet, reason);
    }

    function unsuspendAd(uint256 adId) external onlyOwner {
        require(advertisers[adId].wallet != address(0), "not exist");
        advertisers[adId].suspended = false;
        emit AdUnsuspended(adId, advertisers[adId].wallet);
    }

    function deactivateExpired(uint256 adId) external onlyOwner {
        Advertiser storage ad = advertisers[adId];
        require(ad.active,                       "already inactive");
        require(block.timestamp >= ad.expiresAt, "not expired yet");
        ad.active = false;
        if (activeSlots > 0) activeSlots--;
        emit AdExpired(adId, ad.wallet);
    }

    /**
     * @notice Proses daftar tunggu banner ke slot kosong
     */
    function processWaitlist(uint256 slotIdx) external onlyOwner {
        require(slotIdx < MAX_BANNERS, "invalid slot");
        require(
            !bannerSlots[slotIdx].active || block.timestamp > bannerSlots[slotIdx].endTime,
            "slot still active"
        );
        require(bannerWaitlist.length > 0, "waitlist empty");

        address next = bannerWaitlist[0];
        for (uint256 i = 0; i < bannerWaitlist.length - 1; i++) {
            bannerWaitlist[i] = bannerWaitlist[i + 1];
        }
        bannerWaitlist.pop();

        uint256 adId = sellerAdId[next];
        if (adId == 0 || !advertisers[adId].active ||
            advertisers[adId].suspended ||
            block.timestamp >= advertisers[adId].expiresAt) {
            emit RemovedFromWaitlist(next);
            return;
        }

        uint256 fee = _bannerFee(advertisers[adId].category);
        bool ok = indc.transferFrom(next, devWallet, fee);
        if (!ok) { emit RemovedFromWaitlist(next); return; }

        totalRevenue += fee;
        bannerSlots[slotIdx] = BannerSlot({
            advertiser : next,
            startTime  : block.timestamp,
            endTime    : block.timestamp + BANNER_DURATION,
            active     : true
        });

        emit BannerRegistered(next, slotIdx, block.timestamp + BANNER_DURATION);
    }

    function setPaused(bool _p)           external onlyOwner { paused = _p; emit ContractPaused(_p); }
    function setDevWallet(address w)      external onlyOwner { require(w != address(0),"zero"); emit DevWalletChanged(devWallet,w); devWallet = w; }
    function rescueTokens(uint256 amount) external onlyOwner { indc.transfer(devWallet, amount); }

    // ─────────────────────────────────────────────
    //  D. VIEW
    // ─────────────────────────────────────────────

    function getAdvertiser(uint256 adId)  external view returns (Advertiser memory) { return advertisers[adId]; }
    function getMyAd()                    external view returns (Advertiser memory) { return advertisers[sellerAdId[msg.sender]]; }
    function getActiveSlots()             external view returns (uint256) { return activeSlots; }
    function getRemainingSlots()          external view returns (uint256) { return MAX_SLOTS > activeSlots ? MAX_SLOTS - activeSlots : 0; }
    function getWaitlistLength()          external view returns (uint256) { return bannerWaitlist.length; }
    function getBannerSlots()             external view returns (BannerSlot[20] memory) { return bannerSlots; }

    function isAdActive(address seller) external view returns (bool) {
        uint256 id = sellerAdId[seller];
        if (id == 0) return false;
        Advertiser storage ad = advertisers[id];
        return ad.active && !ad.suspended && block.timestamp < ad.expiresAt;
    }

    function isExpiringSoon(address seller) external view returns (bool) {
        uint256 id = sellerAdId[seller];
        if (id == 0) return false;
        uint256 exp = advertisers[id].expiresAt;
        return block.timestamp >= exp - EXPIRE_WARN && block.timestamp < exp;
    }

    function getWaitlistPosition(address addr) external view returns (int256) {
        for (uint256 i = 0; i < bannerWaitlist.length; i++) {
            if (bannerWaitlist[i] == addr) return int256(i + 1);
        }
        return -1;
    }

    function getActiveBanners() external view returns (address[] memory addrs, uint256[] memory ends) {
        uint256 count;
        for (uint256 i = 0; i < MAX_BANNERS; i++) {
            if (bannerSlots[i].active && block.timestamp <= bannerSlots[i].endTime) count++;
        }
        addrs = new address[](count);
        ends  = new uint256[](count);
        uint256 idx;
        for (uint256 i = 0; i < MAX_BANNERS; i++) {
            if (bannerSlots[i].active && block.timestamp <= bannerSlots[i].endTime) {
                addrs[idx] = bannerSlots[i].advertiser;
                ends[idx]  = bannerSlots[i].endTime;
                idx++;
            }
        }
    }

    // ─────────────────────────────────────────────
    //  E. INTERNAL
    // ─────────────────────────────────────────────

    function _regFee(Category c)    internal pure returns (uint256) {
        if (c == Category.UMKM) return FEE_UMKM;
        if (c == Category.UD)   return FEE_UD;
        if (c == Category.CV)   return FEE_CV;
        return FEE_PT;
    }
    function _designFee(Category c) internal pure returns (uint256) {
        if (c == Category.UMKM) return DESIGN_UMKM;
        if (c == Category.UD)   return DESIGN_UD;
        if (c == Category.CV)   return DESIGN_CV;
        return DESIGN_PT;
    }
    function _bannerFee(Category c) internal pure returns (uint256) {
        if (c == Category.UMKM) return BANNER_UMKM;
        if (c == Category.UD)   return BANNER_UD;
        if (c == Category.CV)   return BANNER_CV;
        return BANNER_PT;
    }
}
