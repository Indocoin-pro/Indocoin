"""
INDOCOIN — Fix Auto-Connect Wallet Semua Halaman
=================================================
Jalankan di root folder project (GitHub Codespaces):
  python3 fix_autoconnect.py
"""
import re, shutil
from pathlib import Path

def patch_file(filepath):
    original = filepath.read_text(encoding='utf-8')
    content  = original

    # FIX 1: tambah param silent ke connectWallet()
    content = re.sub(
        r'(async\s+function\s+connectWallet\s*\(\s*\)\s*\{)',
        r'async function connectWallet(silent = false) {',
        content
    )

    # FIX 2: guard provider.send("eth_requestAccounts")
    def guard_send(m):
        indent = m.group(1)
        return (f'\n{indent}if (!silent) await provider.send("eth_requestAccounts", []);'
                f'\n{indent}else {{ const _chk = await provider.getSigner(); if (!_chk) throw new Error("no wallet"); }}')
    content = re.sub(
        r'\n(\s*)await\s+provider\.send\s*\(\s*["\']eth_requestAccounts["\']\s*,\s*\[\]\s*\)\s*;',
        guard_send, content
    )

    # FIX 2b: guard window.ethereum.request eth_requestAccounts
    def guard_req(m):
        indent = m.group(1)
        return (f'\n{indent}if (!silent) await window.ethereum.request({{method:"eth_requestAccounts"}});'
                f'\n{indent}else {{ const _chk = await provider.getSigner(); if (!_chk) throw new Error("no wallet"); }}')
    content = re.sub(
        r'\n(\s*)await\s+window\.ethereum\.request\s*\(\s*\{\s*method\s*:\s*["\']eth_requestAccounts["\']\s*\}\s*\)\s*;',
        guard_req, content
    )

    # FIX 3: auto-connect panggil connectWallet(true)
    content = re.sub(
        r'(if\s*\(_acc\.length\s*>\s*0\))\s+await\s+connectWallet\(\)',
        r'\1 await connectWallet(true)', content
    )
    content = re.sub(
        r'(if\s*\(accounts?\.length\s*>\s*0\))\s+await\s+connectWallet\(\)',
        r'\1 await connectWallet(true)', content
    )
    content = re.sub(
        r'(if\s*\(accs?\.length\s*>\s*0\))\s+await\s+connectWallet\(\)',
        r'\1 await connectWallet(true)', content
    )

    return content, content != original

def main():
    script_dir = Path(__file__).parent
    backup_dir = script_dir / 'backup_html'
    backup_dir.mkdir(exist_ok=True)
    html_files = sorted(script_dir.glob('*.html'))

    print('=' * 60)
    print('  INDOCOIN — Fix Auto-Connect Wallet')
    print(f'  {len(html_files)} file HTML ditemukan')
    print('=' * 60)

    changed, skipped, errors = [], [], []

    for fpath in html_files:
        try:
            new_content, did_change = patch_file(fpath)
            if did_change:
                shutil.copy2(fpath, backup_dir / fpath.name)
                fpath.write_text(new_content, encoding='utf-8')
                changed.append(fpath.name)
                print(f'  ✅ FIXED  : {fpath.name}')
            else:
                skipped.append(fpath.name)
                print(f'  ⏭️  SKIP   : {fpath.name}')
        except Exception as e:
            errors.append(fpath.name)
            print(f'  ❌ ERROR  : {fpath.name} — {e}')

    print('=' * 60)
    print(f'  ✅ Fixed  : {len(changed)} file')
    print(f'  ⏭️  Skip   : {len(skipped)} file')
    print(f'  ❌ Error  : {len(errors)} file')
    print('=' * 60)
    print()
    print('  Sekarang push ke GitHub:')
    print('  git add .')
    print('  git commit -m "fix: silent auto-connect wallet"')
    print('  git push')
    print('=' * 60)

if __name__ == '__main__':
    main()
