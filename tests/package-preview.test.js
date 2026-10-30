// tests/package-preview.test.js — Issue #160 回帰検査
// preview ZIP の許可ファイル集合・秘密マーカー検査・開発 Client ID 維持を pin する。
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, scanForSecrets } from '../scripts/package-preview.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('package-preview allowlist (Issue #160)', () => {
  it('includes every file the extension needs and nothing secret-like', () => {
    const files = collectFiles(ROOT);
    // 動作に必須のファイルが揃っている
    for (const required of [
      'manifest.json', 'background.js', 'background-functions.js',
      'popup.html', 'popup.js', 'content.js', 'icon.png',
    ]) {
      expect(files).toContain(required);
    }
    // bootstrap/_locales 配下の実ファイルが収集されている
    expect(files.some(f => f.startsWith('_locales/'))).toBe(true);
    expect(files.some(f => f.startsWith('bootstrap/'))).toBe(true);
    // 配布禁止領域が混入していない
    for (const f of files) {
      expect(f).not.toMatch(/node_modules|tests|scripts|\.git|\.env|\.pem$|coverage|dist|\.codex|screenshots|\.github/);
    }
  });

  it('rejects missing required files', () => {
    expect(() => collectFiles('/nonexistent-dir')).toThrow(/required file missing/);
  });

  it('flags secret markers in staged content', () => {
    const tmp = join(ROOT, 'tests', '.tmp-secret-scan');
    mkdirSync(tmp, { recursive: true });
    try {
      writeFileSync(join(tmp, 'a.js'), 'var k = "-----BEGIN PRIVATE KEY-----\\nabc";');
      writeFileSync(join(tmp, 'b.js'), 'var c = "client_secret: zzz";');
      const v = scanForSecrets(tmp, ['a.js', 'b.js']);
      expect(v.length).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('keeps the development clientId (no prod substitution in preview)', () => {
    // preview package は本番 secrets 置換を行わない前提を pin する
    const popup = readFileSync(join(ROOT, 'popup.js'), 'utf-8');
    expect(popup).toContain("const clientId = 'lt060jwpltwp3weqdk53dx450aj99p'");
  });
});
