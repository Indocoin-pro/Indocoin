// Tambahkan wallet yang belum ada di collection 'members' Firestore
// Pakai REST API langsung — tanpa perlu install firebase SDK
// Jalanin: node add-missing-members.js

const https = require('https');

const PROJECT_ID = 'indocoin-network';
const API_KEY    = 'AIzaSyBrhDJiIcEJsZ-fN0RIDlV0XaOA8ZPjJsw';

// ═══════════════════════════════════════════════════════
// TAMBAH WALLET BARU DI SINI — tinggal copy-paste ke bawah
// Format: { wallet: '0x...', name: 'Nama' }
// ═══════════════════════════════════════════════════════
const WALLETS = [
  // Batch 1
  { wallet: '0x2A7f8fF84A4Ac16f7c6711484A7dA3FA26280e2D', name: '' },
  { wallet: '0x457fbD02810097E47e3BD2de0B25eda1c95f7658', name: '' },
  { wallet: '0x449742958CB70EfACe1f772180c41aa52B1CF714', name: '' },
  { wallet: '0xA2f514b45834DB0cCE98C1E386C26589b05c1C11', name: '' },
];
// ═══════════════════════════════════════════════════════

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAnonymousToken() {
  const body = JSON.stringify({ returnSecureToken: true });
  const res = await httpsRequest({
    hostname: 'identitytoolkit.googleapis.com',
    path: `/v1/accounts:signUp?key=${API_KEY}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  const data = JSON.parse(res.body);
  return data.idToken;
}

async function docExists(token, docId) {
  const res = await httpsRequest({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/members/${docId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.status === 200;
}

async function createDoc(token, docId, wallet, name) {
  const body = JSON.stringify({
    fields: {
      wallet:         { stringValue: wallet },
      name:           { stringValue: name || '' },
      createdAt:      { integerValue: Date.now() },
      migratedManual: { booleanValue: true }
    }
  });
  const res = await httpsRequest({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/members?documentId=${docId}`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  return res.status === 200;
}

async function main() {
  if (WALLETS.length === 0) {
    console.log('Daftar wallet kosong.');
    return;
  }

  console.log('Mendapatkan token Firebase...');
  const token = await getAnonymousToken();
  console.log('Token OK. Memproses', WALLETS.length, 'wallet...\n');

  let added = 0, skipped = 0, failed = 0;

  for (const { wallet, name } of WALLETS) {
    const docId = wallet.toLowerCase().trim();
    try {
      const exists = await docExists(token, docId);
      if (exists) {
        console.log(`Skip (sudah ada): ${docId}`);
        skipped++;
        continue;
      }
      const ok = await createDoc(token, docId, docId, name);
      if (ok) {
        console.log(`Ditambahkan: ${docId}`);
        added++;
      } else {
        console.log(`Gagal tambah: ${docId}`);
        failed++;
      }
    } catch(e) {
      console.error(`Error: ${docId} —`, e.message);
      failed++;
    }
  }

  console.log(`\nSelesai: ${added} ditambah, ${skipped} dilewati, ${failed} gagal`);
}

main();
