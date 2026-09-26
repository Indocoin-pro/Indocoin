// MIGRASI: pindahin user lama yang wallet-nya UDAH ke-link dari koleksi
// lama ("users", keyed by Firebase UID) ke koleksi baru ("members", keyed
// by wallet address) yang dipakai sistem wallet-only sekarang.
//
// AMAN dijalankan berkali-kali: kalau sebuah wallet udah ada di "members",
// dilewatin (gak ditimpa) — jadi gak bakal ngerusak data yang udah didaftar
// lewat landing.html versi baru.
//
// Jalanin: node migrate-old-users-to-members.js
const https = require('https');

const PROJECT_ID = "indocoin-network";
const API_KEY    = "AIzaSyBrhDJiIcEJsZ-fN0RIDlV0XaOA8ZPjJsw";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function httpPatch(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch(e) { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function field(doc, name) {
  const f = doc.fields && doc.fields[name];
  if (!f) return '';
  return f.stringValue !== undefined ? f.stringValue : '';
}
function fieldTimestamp(doc, name) {
  const f = doc.fields && doc.fields[name];
  return f && f.timestampValue ? f.timestampValue : new Date().toISOString();
}

async function memberExists(wallet) {
  const res = await httpGet(`${BASE}/members/${wallet}?key=${API_KEY}`);
  return !(res.error && res.error.code === 404);
}

async function writeMember(wallet, name, referral, registeredAt) {
  const payload = {
    fields: {
      wallet:       { stringValue: wallet },
      name:         { stringValue: name || '' },
      referral:     { stringValue: referral || '' },
      registeredAt: { timestampValue: registeredAt },
      blocked:      { booleanValue: false },
      migratedFromLegacy: { booleanValue: true }
    }
  };
  return httpPatch(`${BASE}/members/${wallet}?key=${API_KEY}`, payload);
}

async function main() {
  let pageToken = undefined;
  let scanned = 0, migrated = 0, skippedNoWallet = 0, skippedAlready = 0, failed = 0;

  do {
    let url = `${BASE}/users?pageSize=200&key=${API_KEY}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const page = await httpGet(url);
    if (page.error) { console.log("ERROR:", JSON.stringify(page.error)); return; }

    const docs = page.documents || [];
    for (const doc of docs) {
      scanned++;
      const walletRaw = field(doc, 'wallet');
      if (!walletRaw || walletRaw.trim() === '') { skippedNoWallet++; continue; }
      const wallet = walletRaw.toLowerCase();

      const already = await memberExists(wallet);
      if (already) { skippedAlready++; continue; }

      const name = field(doc, 'name');
      const referral = field(doc, 'referralCode');
      const registeredAt = fieldTimestamp(doc, 'createdAt');

      const result = await writeMember(wallet, name, referral, registeredAt);
      if (result.status >= 200 && result.status < 300) {
        migrated++;
      } else {
        failed++;
        console.log(`Gagal migrasi ${wallet}:`, JSON.stringify(result.body));
      }

      if (scanned % 50 === 0) console.log(`...progress: ${scanned} discan, ${migrated} berhasil dipindah`);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  console.log(`\n=== SELESAI ===`);
  console.log(`Total user lama discan     : ${scanned}`);
  console.log(`Berhasil dipindah ke members: ${migrated}`);
  console.log(`Dilewati (sudah ada)        : ${skippedAlready}`);
  console.log(`Dilewati (gak ada wallet)   : ${skippedNoWallet}`);
  console.log(`Gagal                       : ${failed}`);
}

main().catch(e => console.error("Fatal:", e.message));
