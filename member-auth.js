/**
 * INDOCOIN MEMBER AUTH v1 — sistem identitas berbasis WALLET
 * Menggantikan login email/password Firebase.
 *
 * Kenapa lewat REST API, bukan Firebase SDK:
 * Beberapa halaman pakai Firebase SDK versi "modular" (v11), beberapa lagi
 * (brainclash*.html) masih pakai versi lama "compat". Dua-duanya beda cara
 * manggil Firestore. Biar file ini bisa dipakai di SEMUA halaman tanpa
 * peduli versi SDK apa yang dimuat duluan, di sini kita panggil Firestore
 * langsung lewat REST API (fetch biasa) — gak nyandar ke SDK apapun.
 *
 * Cara pakai (di halaman manapun, taruh setelah <script src="member-auth.js">):
 *
 *   const member = await IndocoinMemberAuth.requireMember();
 *   if (!member) {
 *     // belum connect wallet ATAU wallet belum terdaftar → arahkan ke landing.html
 *   } else if (member.blocked) {
 *     // wallet terdaftar tapi diblokir admin → tampilkan pesan blokir
 *   } else {
 *     // valid, lanjut render halaman. member.wallet, member.name tersedia.
 *   }
 *
 * Collection Firestore: "members", document ID = alamat wallet (huruf kecil).
 */
(function (window) {
  'use strict';

  const PROJECT_ID = "indocoin-network";
  const API_KEY     = "AIzaSyBrhDJiIcEJsZ-fN0RIDlV0XaOA8ZPjJsw";
  const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  // ── Konversi format field Firestore REST <-> objek JS biasa ──────────
  function fsFieldsToObj(fields) {
    const out = {};
    for (const k in fields) {
      const v = fields[k];
      if (v.stringValue !== undefined) out[k] = v.stringValue;
      else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
      else if (v.integerValue !== undefined) out[k] = parseInt(v.integerValue, 10);
      else if (v.timestampValue !== undefined) out[k] = v.timestampValue;
      else out[k] = null;
    }
    return out;
  }
  function objToFsFields(obj) {
    const fields = {};
    for (const k in obj) {
      const v = obj[k];
      if (typeof v === 'string') fields[k] = { stringValue: v };
      else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
      else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
      else fields[k] = { nullValue: null };
    }
    return fields;
  }

  /**
   * Ambil data member berdasarkan alamat wallet.
   * Balikin null kalau belum terdaftar / gagal.
   */
  async function getMember(wallet) {
    if (!wallet) return null;
    const addr = wallet.toLowerCase();
    try {
      const res = await fetch(`${BASE}/members/${addr}?key=${API_KEY}`, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const doc = await res.json();
      return fsFieldsToObj(doc.fields || {});
    } catch (e) {
      return null;
    }
  }

  /**
   * Daftarkan wallet baru sebagai member. Dipanggil dari landing.html pas
   * submit form daftar. Menimpa (bukan gabung) dokumennya.
   */
  async function registerMember(wallet, data) {
    if (!wallet) return { ok: false, reason: 'no-wallet' };
    const addr = wallet.toLowerCase();

    // Cegah daftar dobel di alamat yang sama
    const existing = await getMember(addr);
    if (existing) return { ok: false, reason: 'already-registered', member: existing };

    const payload = {
      fields: objToFsFields({
        wallet: addr,
        name: (data && data.name) || '',
        referral: (data && data.referral) || '',
        registeredAt: new Date().toISOString(),
        blocked: false
      })
    };
    try {
      const res = await fetch(`${BASE}/members/${addr}?key=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, reason: 'network-error', error: e.message };
    }
  }

  /**
   * Minta koneksi wallet secara aktif (munculin prompt MetaMask/Trust/dll).
   * Kalau window.ethereum gak ada, biarkan wallet-bridge.js (kalau dimuat
   * di halaman itu) yang nampilin modal deep-link — fungsi ini cuma
   * balikin null di kondisi itu.
   */
  async function connectWallet() {
    if (typeof window.ethereum === 'undefined') return null;
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      return accounts && accounts[0] ? accounts[0].toLowerCase() : null;
    } catch (e) {
      return null; // user nolak connect, atau error lain
    }
  }

  /**
   * Cek wallet yang SUDAH connect sebelumnya (gak munculin prompt apapun).
   * Dipakai buat auto-detect pas halaman pertama dibuka.
   */
  async function getConnectedWallet() {
    if (typeof window.ethereum === 'undefined') return null;
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      return accounts && accounts[0] ? accounts[0].toLowerCase() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Fungsi utama buat halaman yang butuh "wajib member & gak diblokir".
   * - null            → belum connect wallet, ATAU wallet belum terdaftar
   * - {blocked:true}  → wallet terdaftar tapi diblokir admin
   * - {wallet,name,…} → valid, boleh lanjut
   */
  async function requireMember() {
    const addr = await getConnectedWallet();
    if (!addr) return null;

    const member = await getMember(addr);
    if (!member) return null;
    if (member.blocked === true) return { blocked: true, wallet: addr };
    return Object.assign({ wallet: addr }, member);
  }

  window.IndocoinMemberAuth = {
    getMember,
    registerMember,
    connectWallet,
    getConnectedWallet,
    requireMember
  };
})(window);
