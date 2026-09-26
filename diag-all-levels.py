#!/usr/bin/env python3
# Diagnostik: cek status program-check untuk SEMUA level (1-10) dari root.
import json, urllib.request, time

ROOT = "0xa16E9579E19eB19e6E24B211121BdCD7996809Cc"
BASE = "https://bot-feed.indocoin.id"

def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)

def check_programs(addrs):
    active = confirmed_empty = never_checked = 0
    for i in range(0, len(addrs), 30):
        chunk = addrs[i:i+30]
        url = f"{BASE}/api/member-programs?addresses=" + ",".join(chunk)
        data = fetch(url).get("data", {})
        for a in chunk:
            entry = data.get(a)
            if entry is None:
                never_checked += 1
            elif len(entry.get("list", [])) > 0:
                active += 1
            else:
                confirmed_empty += 1
    return active, confirmed_empty, never_checked

print(f"{'Level':<6}{'Total':<8}{'Aktif':<8}{'Kosong':<10}{'BelumCek':<10}")
grand_active = grand_total = grand_never = 0
for lvl in range(1, 11):
    try:
        dl = fetch(f"{BASE}/api/downline-level?address={ROOT}&level={lvl}")
        addrs = dl.get("downlines", [])
        if not addrs:
            print(f"{lvl:<6}{0:<8}{'-':<8}{'-':<10}{'-':<10}")
            continue
        active, empty, never = check_programs(addrs)
        grand_active += active; grand_total += len(addrs); grand_never += never
        print(f"{lvl:<6}{len(addrs):<8}{active:<8}{empty:<10}{never:<10}")
    except Exception as e:
        print(f"{lvl:<6} ERROR: {e}")
    time.sleep(0.5)

print(f"\nTOTAL semua level: {grand_total} wallet, {grand_active} aktif, {grand_never} belum pernah dicek")
