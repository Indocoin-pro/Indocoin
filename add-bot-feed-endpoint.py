#!/usr/bin/env python3
# Script v2 — SESUAI struktur handler asli di server.js INDOCOIN
# Sisipkan endpoint /api/bot-live-feed INSIDE const handler function

SERVER_JS = '/root/indocoin/server.js'

NEW_HANDLER_CODE = '''
  // ── BOT RADAR LIVE FEED — for dashboard ──────────────
  if (req.method === 'GET' && req.url === '/api/bot-live-feed') {
    try {
      const fs = require('fs');
      const bots = ['arbibot', 'venus', 'triangular', 'stablecoin', 'aave', 'v2v3'];
      const feed = [];
      bots.forEach(bot => {
        try {
          const data = fs.readFileSync(`/root/.pm2/logs/${bot}-out.log`, 'utf-8');
          const lines = data.split('\\n').filter(l => l.trim()).slice(-15);
          lines.forEach(line => {
            if (/Private|private_key|wallet:/i.test(line)) return;
            if (/⛽ BNB:/i.test(line)) return;
            if (/BNB tidak cukup/i.test(line)) return;
            if (line.includes('◇ injected env')) return;
            let clean = line.replace(/0x[a-fA-F0-9]{40}/g, m =>
              m.slice(0, 6) + '...' + m.slice(-4)
            );
            if (/Scan #|✨|⚡|✅|❌|borrower|liquidation|EKSEKUSI|peluang|SUCCESS|sehat|Profit/.test(clean)) {
              feed.push({ bot: bot.toUpperCase(), text: clean.substring(0, 180) });
            }
          });
        } catch(e) {}
      });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        feed: feed.slice(-60),
        timestamp: new Date().toISOString(),
        bots_running: bots.length,
      }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'feed error' }));
    }
    return;
  }
'''

with open(SERVER_JS, 'r') as f:
    content = f.read()

# Hapus endpoint lama yang error (kalau ada)
if 'app.get(\'/api/bot-live-feed\'' in content:
    start_marker = '\n// ─────────────────────────────────────────────────────\n// LIVE BOT FEED'
    end_marker = '});\n'
    start_idx = content.find(start_marker)
    if start_idx > 0:
        # Cari end marker dari start_idx
        end_idx = content.find('});\n', start_idx)
        if end_idx > 0:
            content = content[:start_idx] + content[end_idx+4:]
            print("🗑️  Endpoint lama Express dihapus")

# Cek apakah endpoint sudah ada
if 'BOT RADAR LIVE FEED' in content:
    print("⚠️  Endpoint sudah ada, skip")
else:
    # Sisipkan tepat setelah baris `const handler = (req, res) => {`
    marker = 'const handler = (req, res) => {'
    if marker in content:
        content = content.replace(marker, marker + NEW_HANDLER_CODE)
        with open(SERVER_JS, 'w') as f:
            f.write(content)
        print("✅ Endpoint /api/bot-live-feed sukses ditambahkan ke handler")
    else:
        print("❌ Pattern 'const handler = (req, res) => {' tidak ditemukan")
        print("    Cek manual struktur server.js")
        exit(1)

print("\nSekarang jalankan: pm2 restart indocoin")
