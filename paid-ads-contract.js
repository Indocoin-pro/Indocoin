/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║     INDOCOIN PAID ADS — CONTRACT INTEGRATION v2              ║
 * ║     paid-ads-contract.js                                     ║
 * ║                                                              ║
 * ║  Requires: ethers.js v5.7.2                                  ║
 * ║  Include : <script src="paid-ads-contract.js"></script>      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ─────────────────────────────────────────────
//  CONFIG — UPDATE SETELAH DEPLOY
// ─────────────────────────────────────────────
const PAID_ADS_CONFIG = {
    CONTRACT_ADDRESS : "0x499Ce9f59A5Ad5b096430Df645D17e262A2cA7Bd",
    INDC_ADDRESS     : "0xD772c96e1beFd2ea9C9a83182c71f4d32f306571",
    CHAIN_ID         : 56,
    RPC_URL          : "https://bsc-dataseed.binance.org/",
    INDC_DECIMAL     : 9,
    INDC_UNIT        : BigInt("1000000000"),
    INDC_PRICE_USD   : 0.003,
    FEES: {
        UMKM_REG: 1_825_000, UD_REG: 3_650_000, CV_REG: 10_950_000, PT_REG: 18_250_000,
        DESIGN_UMKM: 10_000, DESIGN_UD: 20_000, DESIGN_CV: 30_000, DESIGN_PT: 50_000,
        BANNER_UMKM: 150_000, BANNER_UD: 300_000, BANNER_CV: 500_000, BANNER_PT: 750_000,
    },
};

const PAID_ADS_ABI = [
    // Write
    "function registerAd(uint8 category, bool wantDesign) external",
    "function renewAd() external",
    "function registerBanner() external",
    "function leaveWaitlist() external",

    // View
    "function getAdvertiser(uint256 adId) external view returns (tuple(address wallet, uint8 category, uint256 registeredAt, uint256 expiresAt, bool active, bool suspended, uint256 adId))",
    "function getMyAd() external view returns (tuple(address wallet, uint8 category, uint256 registeredAt, uint256 expiresAt, bool active, bool suspended, uint256 adId))",
    "function getActiveSlots() external view returns (uint256)",
    "function getRemainingSlots() external view returns (uint256)",
    "function isAdActive(address seller) external view returns (bool)",
    "function isExpiringSoon(address seller) external view returns (bool)",
    "function getActiveBanners() external view returns (address[], uint256[])",
    "function getWaitlistPosition(address addr) external view returns (int256)",
    "function getWaitlistLength() external view returns (uint256)",
    "function sellerAdId(address) external view returns (uint256)",

    // Events
    "event AdRegistered(uint256 indexed adId, address indexed seller, uint8 category, uint256 fee, uint256 expiresAt)",
    "event AdRenewed(uint256 indexed adId, address indexed seller, uint256 newExpiry)",
    "event BannerRegistered(address indexed advertiser, uint256 slotIdx, uint256 endTime)",
    "event AddedToWaitlist(address indexed advertiser, uint256 position)",
];

const INDC_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
];

// ─────────────────────────────────────────────
//  MAIN OBJECT
// ─────────────────────────────────────────────
const PaidAdsContract = {

    provider: null, signer: null,
    contract: null, indc: null,
    userAddr: null,

    // ── INIT ──
    async init() {
        if (!window.ethereum) throw new Error("MetaMask tidak ditemukan!");

        this.provider = new ethers.providers.Web3Provider(window.ethereum);
        await this.provider.send("eth_requestAccounts", []);

        const net = await this.provider.getNetwork();
        if (net.chainId !== PAID_ADS_CONFIG.CHAIN_ID) await this._switchBSC();

        this.signer   = this.provider.getSigner();
        this.userAddr = await this.signer.getAddress();

        this.contract = new ethers.Contract(PAID_ADS_CONFIG.CONTRACT_ADDRESS, PAID_ADS_ABI, this.signer);
        this.indc     = new ethers.Contract(PAID_ADS_CONFIG.INDC_ADDRESS, INDC_ABI, this.signer);

        console.log("✅ PaidAds init:", this.userAddr);
        return this.userAddr;
    },

    async _switchBSC() {
        try {
            await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
        } catch (e) {
            if (e.code === 4902) {
                await window.ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [{ chainId: "0x38", chainName: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: [PAID_ADS_CONFIG.RPC_URL], blockExplorerUrls: ["https://bscscan.com/"] }],
                });
            } else throw e;
        }
    },

    // ── HELPERS ──
    toINDC(amount)    { return BigInt(Math.round(amount)) * PAID_ADS_CONFIG.INDC_UNIT; },
    fromINDC(raw)     { return Number(BigInt(raw.toString()) / PAID_ADS_CONFIG.INDC_UNIT); },
    toUSD(indc)       { return (indc * PAID_ADS_CONFIG.INDC_PRICE_USD).toFixed(2); },

    async getBalance(addr) {
        const raw = await this.indc.balanceOf(addr || this.userAddr);
        return this.fromINDC(raw);
    },

    async _approve(amountINDC) {
        const need = this.toINDC(amountINDC);
        const cur  = await this.indc.allowance(this.userAddr, PAID_ADS_CONFIG.CONTRACT_ADDRESS);
        if (BigInt(cur.toString()) < need) {
            const tx = await this.indc.approve(PAID_ADS_CONFIG.CONTRACT_ADDRESS, ethers.constants.MaxUint256);
            await tx.wait();
        }
    },

    // ── PENDAFTARAN ──
    /**
     * Daftar iklan baru
     * @param {string}  category   "umkm"|"ud"|"cv"|"pt"
     * @param {boolean} wantDesign minta desain banner
     */
    async registerAd(category, wantDesign = false) {
        const catIdx = { umkm:0, ud:1, cv:2, pt:3 }[category.toLowerCase()];
        if (catIdx === undefined) throw new Error("Kategori tidak valid");

        const regFees    = [PAID_ADS_CONFIG.FEES.UMKM_REG, PAID_ADS_CONFIG.FEES.UD_REG, PAID_ADS_CONFIG.FEES.CV_REG, PAID_ADS_CONFIG.FEES.PT_REG];
        const desFees    = [PAID_ADS_CONFIG.FEES.DESIGN_UMKM, PAID_ADS_CONFIG.FEES.DESIGN_UD, PAID_ADS_CONFIG.FEES.DESIGN_CV, PAID_ADS_CONFIG.FEES.DESIGN_PT];
        const total      = regFees[catIdx] + (wantDesign ? desFees[catIdx] : 0);

        await this._approve(total);
        const tx      = await this.contract.registerAd(catIdx, wantDesign);
        const receipt = await tx.wait();
        const ev      = receipt.events?.find(e => e.event === "AdRegistered");
        const adId    = ev?.args?.adId?.toNumber();

        console.log("✅ Iklan terdaftar! adId:", adId);
        return { receipt, adId };
    },

    /**
     * Perpanjang iklan
     * @param {string} category untuk hitung fee
     */
    async renewAd(category) {
        const fees = { umkm: PAID_ADS_CONFIG.FEES.UMKM_REG, ud: PAID_ADS_CONFIG.FEES.UD_REG, cv: PAID_ADS_CONFIG.FEES.CV_REG, pt: PAID_ADS_CONFIG.FEES.PT_REG };
        await this._approve(fees[category.toLowerCase()]);
        const tx = await this.contract.renewAd();
        return await tx.wait();
    },

    // ── BANNER ──
    /**
     * Daftar banner dashboard
     * @param {string} category untuk hitung fee
     */
    async registerBanner(category) {
        const fees = { umkm: PAID_ADS_CONFIG.FEES.BANNER_UMKM, ud: PAID_ADS_CONFIG.FEES.BANNER_UD, cv: PAID_ADS_CONFIG.FEES.BANNER_CV, pt: PAID_ADS_CONFIG.FEES.BANNER_PT };
        await this._approve(fees[category.toLowerCase()]);
        const tx      = await this.contract.registerBanner();
        const receipt = await tx.wait();
        const onWait  = receipt.events?.some(e => e.event === "AddedToWaitlist");
        return { receipt, status: onWait ? "waitlist" : "active" };
    },

    async leaveWaitlist() {
        const tx = await this.contract.leaveWaitlist();
        return await tx.wait();
    },

    // ── READ ──
    async getSlotInfo() {
        const [active, remaining] = await Promise.all([
            this.contract.getActiveSlots(),
            this.contract.getRemainingSlots(),
        ]);
        return { active: active.toNumber(), remaining: remaining.toNumber(), total: 100 };
    },

    async getMyAdInfo() {
        const ad = await this.contract.getMyAd();
        if (ad.wallet === ethers.constants.AddressZero) return null;
        const catNames = ["UMKM","UD","CV","PT"];
        return {
            adId:       ad.adId.toNumber(),
            category:   catNames[ad.category],
            expiry:     new Date(ad.expiresAt.toNumber() * 1000),
            active:     ad.active,
            suspended:  ad.suspended,
            daysLeft:   Math.ceil((ad.expiresAt.toNumber() * 1000 - Date.now()) / 86_400_000),
            expiringSoon: Date.now() > (ad.expiresAt.toNumber() - 7*86400) * 1000,
        };
    },

    async isAdActive(seller)     { return await this.contract.isAdActive(seller); },
    async isExpiringSoon(seller) { return await this.contract.isExpiringSoon(seller); },

    async getActiveBanners() {
        const [addrs, ends] = await this.contract.getActiveBanners();
        return addrs.map((a, i) => ({ advertiser: a, endTime: new Date(ends[i].toNumber() * 1000) }));
    },

    async getMyWaitlistPosition() {
        const pos = await this.contract.getWaitlistPosition(this.userAddr);
        return pos.toNumber(); // -1 jika tidak ada di waitlist
    },
};

window.PaidAdsContract = PaidAdsContract;
window.PAID_ADS_CONFIG = PAID_ADS_CONFIG;
