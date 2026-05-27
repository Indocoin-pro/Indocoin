#!/usr/bin/env python3
# Script untuk menambahkan endpoint /api/bot-live-feed ke server.js
# Jalankan: python3 /tmp/add-bot-feed-endpoint.py

SERVER_JS = '/root/indocoin/server.js'

NEW_ENDPOINT = '''
// ─────────────────────────────────────────────────────
// LIVE BOT FEED — Streaming aktivitas 6 bot ke dashboard
// ─────────────────────────────────────────────────────
app.get('/api/bot-live-feed', (req, res) => {
  const fs = require('fs');
  const bots = ['arbibot', 'venus', 'triangular', 'stablecoin', 'aave', 'v2v3'];
  const feed = [];

  bots.forEach(bot => {
    try {
      const data = fs.readFileSync(`/root/.pm2/logs/${bot}-out.log`, 'utf-8');
      const lines = data.split('\\n').filter(l => l.trim()).slice(-15);

      lines.forEach(line => {
        // Skip baris sensitif
        if (/Private|private_key|wallet:/i.test(line)) return;
        if (/⛽ BNB:/i.test(line)) return;
        if (/BNB tidak cukup/i.test(line)) return;
        if (line.includes('◇ injected env')) return;

        // Mask address wallet
        let clean = line.replace(/0x[a-fA-F0-9]{40}/g, m =>
          m.slice(0, 6) + '...' + m.slice(-4)
        );

        // Hanya tampilkan baris menarik
        if (/Scan #|✨|⚡|✅|❌|borrower|liquidation|EKSEKUSI|peluang|SUCCESS|sehat|Profit/.test(clean)) {
          feed.push({
            bot: bot.toUpperCase(),
            text: clean.substring(0, 180),
          });
        }
      });
    } catch(e) { /* skip */ }
  });

  res.json({
    feed: feed.slice(-60),
    timestamp: new Date().toISOString(),
    bots_running: bots.length,
  });
});
'''

with open(SERVER_JS, 'r') as f:
    content = f.read()

if '/api/bot-live-feed' in content:
    print("⚠️  Endpoint sudah ada, skip")
else:
    # Tambahkan sebelum app.listen
    if 'app.listen' in content:
        content = content.replace('app.listen', NEW_ENDPOINT + '\napp.listen')
        with open(SERVER_JS, 'w') as f:
            f.write(content)
        print("✅ Endpoint /api/bot-live-feed berhasil ditambahkan")
    else:
        # Tambahkan di akhir file
        content += NEW_ENDPOINT
        with open(SERVER_JS, 'w') as f:
            f.write(content)
        print("✅ Endpoint ditambahkan di akhir file")

print("\nJalankan: pm2 restart indocoin")
