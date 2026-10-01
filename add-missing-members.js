// Tambahkan wallet yang belum ada di collection 'members' Firestore
// Bisa diupdate bertahap — tinggal tambah wallet baru di daftar WALLETS,
// script otomatis skip yang sudah ada, hanya tambah yang belum.
//
// Jalanin: node add-missing-members.js

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyBrhDJiIcEJsZ-fN0RIDlV0XaOA8ZPjJsw",
  authDomain: "indocoin-network.firebaseapp.com",
  projectId: "indocoin-network",
  storageBucket: "indocoin-network.appspot.com",
  messagingSenderId: "1234567890",
  appId: "indocoin-network"
};

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

async function main() {
  if (WALLETS.length === 0) {
    console.log('Daftar wallet kosong. Tambahkan wallet dulu di bagian WALLETS.');
    return;
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  let added = 0, skipped = 0, failed = 0;

  for (const { wallet, name } of WALLETS) {
    const addr = wallet.toLowerCase().trim();
    try {
      const ref = doc(db, 'members', addr);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        console.log(`⏭️  Skip (sudah ada): ${addr}`);
        skipped++;
        continue;
      }

      await setDoc(ref, {
        wallet: addr,
        name: name || '',
        createdAt: Date.now(),
        migratedManual: true
      });
      console.log(`✅ Ditambahkan: ${addr} (${name || 'tanpa nama'})`);
      added++;
    } catch (e) {
      console.error(`❌ Gagal: ${addr} —`, e.message);
      failed++;
    }
  }

  console.log(`\n=== Selesai: ${added} ditambah, ${skipped} dilewati, ${failed} gagal ===`);
  process.exit(0);
}

main();
