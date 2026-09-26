// Ngitung berapa banyak user lama di Firestore yang UDAH punya wallet
// ke-link vs yang BELUM — buat nentuin seberapa besar dampak migrasi ke
// sistem wallet-only.
//
// Jalanin: node check-old-users-wallet.js
const https = require('https');

const PROJECT_ID = "indocoin-network";
const API_KEY    = "AIzaSyBrhDJiIcEJsZ-fN0RIDlV0XaOA8ZPjJsw";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users`;

function fetchPage(pageToken) {
  return new Promise((resolve, reject) => {
    let url = `${BASE}?pageSize=300&key=${API_KEY}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function extractField(doc, field) {
  const f = doc.fields && doc.fields[field];
  if (!f) return '';
  return f.stringValue !== undefined ? f.stringValue : '';
}

async function main() {
  let pageToken = undefined;
  let total = 0, withWallet = 0, withoutWallet = 0;
  const sampleWithout = [];

  do {
    const page = await fetchPage(pageToken);
    if (page.error) {
      console.log("ERROR dari Firestore:", JSON.stringify(page.error, null, 2));
      return;
    }
    const docs = page.documents || [];
    for (const doc of docs) {
      total++;
      const wallet = extractField(doc, 'wallet');
      const email  = extractField(doc, 'email');
      if (wallet && wallet.trim() !== '') {
        withWallet++;
      } else {
        withoutWallet++;
        if (sampleWithout.length < 10) sampleWithout.push(email || '(no email)');
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  console.log(`Total user lama di Firestore : ${total}`);
  console.log(`Sudah ada wallet ke-link      : ${withWallet}`);
  console.log(`BELUM ada wallet (perlu bridge): ${withoutWallet}`);
  if (sampleWithout.length > 0) {
    console.log(`\nContoh (email) yang belum ada wallet:`);
    sampleWithout.forEach(e => console.log(`  - ${e}`));
  }
}

main().catch(e => console.error("Gagal:", e.message));
