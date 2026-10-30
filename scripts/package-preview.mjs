#!/usr/bin/env node
// package-preview.mjs — previewブランチ push 用の手動導入テストZIP生成 (Issue #160)
//
// 本番 release.yml が行う Client ID 置換・v*タグ Release とは分離し、
// 開発用 Client ID のまま許可ファイル集合だけを ZIP 化する。
// 秘密情報は同梱しない: staging 前に秘密鍵/トークンマーカーを検査し、
// 混入があれば失敗させる。成果物名は Preview + 短縮SHA で配布元を追跡する。

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// 拡張機能の動作に必要なファイルだけを明示許可する（除外一覧方式は使わない）。
// manifest に列挙される icon/html/js/locale を固定列挙し、将来の新規ファイルは
// ここへ足す。node_modules/tests/scripts/.git/.env/PEM/秘密鍵類は絶対に含めない。
export const ALLOWED_FILES = [
  'manifest.json',
  'background.js',
  'background-functions.js',
  'popup.html',
  'popup.js',
  'content.js',
  'icon.png',
];
// manifest と popup.html が実際に参照する assets。promo画像/掲載用HTML は
// 拡張機能が参照しないため含めない。
export const ALLOWED_DIRS = ['_locales', 'bootstrap'];

// 秘密情報マーカー。同梱・混入が検出されたらパッケージを失敗させる。
export const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /client_secret/i,
  /oauth_token["'\s:=]+[A-Za-z0-9_-]{20,}/i,
  /api[_-]?key["'\s:=]+[A-Za-z0-9_-]{20,}/i,
  /bearer\s+[A-Za-z0-9_-]{20,}/i,
];

// 開発用 Client ID（本番 secrets 置換は preview では行わない）。
const DEV_CLIENT_ID = 'lt060jwpltwp3weqdk53dx450aj99p';

export function collectFiles(root = ROOT) {
  const files = [];
  for (const f of ALLOWED_FILES) {
    if (!existsSync(join(root, f))) throw new Error(`required file missing: ${f}`);
    files.push(f);
  }
  for (const dir of ALLOWED_DIRS) {
    const abs = join(root, dir);
    if (!existsSync(abs)) throw new Error(`required dir missing: ${dir}`);
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue; // .DS_Store 等の隠しファイルは除外
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p.slice(root.length + 1));
      }
    };
    walk(abs);
  }
  return files;
}

export function scanForSecrets(root, files) {
  const violations = [];
  for (const rel of files) {
    const text = readFileSync(join(root, rel), 'utf-8');
    for (const pat of SECRET_PATTERNS) {
      if (pat.test(text)) violations.push(`${rel}: ${pat}`);
    }
  }
  return violations;
}

export function packagePreview({ root = ROOT, sha = process.env.GITHUB_SHA || 'local', outDir } = {}) {
  const shortSha = sha.slice(0, 7);
  const stage = join(root, 'dist', 'preview-stage');
  const dist = outDir || join(root, 'dist');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  mkdirSync(dist, { recursive: true });

  const files = collectFiles(root);
  const violations = scanForSecrets(root, files);
  if (violations.length) {
    throw new Error(`secret markers found:\n${violations.join('\n')}`);
  }

  for (const rel of files) {
    const dst = join(stage, rel);
    mkdirSync(resolve(dst, '..'), { recursive: true });
    cpSync(join(root, rel), dst);
  }

  // manifest: version_name で preview+SHA を名乗らせ、本番ZIPと見分ける。
  // key/ID固定・Client ID置換は行わない（issue の範囲外）。
  const manifestPath = join(stage, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  manifest.version_name = `${manifest.version}-preview.${shortSha}`;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // JS 側 Client ID が開発用のままであること（本番 secrets 混入がないこと）を確認。
  for (const js of ['popup.js', 'background-functions.js']) {
    const text = readFileSync(join(stage, js), 'utf-8');
    if (!text.includes(`const clientId = '${DEV_CLIENT_ID}'`)) {
      throw new Error(`${js}: dev clientId not found (production substitution leaked?)`);
    }
  }

  const zipName = `miteruyo-preview-${shortSha}.zip`;
  const zipPath = join(dist, zipName);
  rmSync(zipPath, { force: true });
  execSync(`cd "${stage}" && zip -qr "${zipPath}" . && zip -T "${zipPath}"`, { stdio: 'inherit' });
  const size = statSync(zipPath).size;
  if (size < 10_000) throw new Error(`zip too small (${size}B) — staging likely incomplete`);

  console.log(JSON.stringify({
    zip: zipPath, name: zipName, files: files.length, bytes: size,
    sha: shortSha, clientId: 'dev', version_name: manifest.version_name,
  }));
  return { zipPath, zipName };
}

if (basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] || '')) {
  packagePreview();
}
