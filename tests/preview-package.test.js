import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertClientIdsMatch,
  buildPreviewZip,
  assertSafePreviewInput,
  createPreviewManifest,
  PREVIEW_FILES,
  PREVIEW_INFO_FILENAME
} from '../scripts/build-preview-zip.js';

const previewWorkflow = readFileSync(new URL('../.github/workflows/preview.yml', import.meta.url), 'utf8');
const commitSha = '0123456789abcdef0123456789abcdef01234567';

describe('preview ZIP input allowlist', () => {
  it('contains only the manifest, extension source, referenced assets, and locales', () => {
    expect(PREVIEW_FILES).toEqual([
      'manifest.json',
      'background.js',
      'background-functions.js',
      'content.js',
      'popup.html',
      'popup.js',
      'icon.png',
      '_locales/en/messages.json',
      '_locales/ja/messages.json',
      'bootstrap/css/bootstrap.min.css',
      'bootstrap/css/bootstrap.min.css.map',
      'bootstrap/js/bootstrap.bundle.min.js',
      'bootstrap/js/bootstrap.bundle.min.js.map'
    ]);
  });

  it('rejects environment files, key files, unlisted paths, and credential values', () => {
    for (const file of ['.env', 'config/.env.preview', 'keys/test.pem', 'keys/private.key', 'tests/example.js']) {
      expect(() => assertSafePreviewInput(file, '')).toThrow();
    }
    for (const content of [
      '-----BEGIN PRIVATE KEY-----',
      'const client_secret = "test-client-secret-value";',
      'const clientSecret = `example-secret-123`;',
      'const access_token = "test-access-token-value-long-enough";',
      'const oauthToken = `test-oauth-token-value-long`;'
    ]) {
      expect(() => assertSafePreviewInput('popup.js', content)).toThrow();
    }
  });

  it('allows the checked-in public Client ID and runtime token expressions', () => {
    expect(assertSafePreviewInput('popup.js', "const clientId = 'development-client-id';")).toBe('popup.js');
    expect(() => assertSafePreviewInput('background-functions.js', 'let oauth_token = await loadStoredToken();')).not.toThrow();
    expect(() => assertSafePreviewInput('background-functions.js', 'const accessToken = tokenResult.accessToken;')).not.toThrow();
  });
});

describe('preview manifest and OAuth status', () => {
  it('marks the manifest name with Preview and the source commit while preserving version and no key', () => {
    const sourceManifest = { name: 'Miteruyo', version: '1.9.12', manifest_version: 3 };
    const previewManifest = createPreviewManifest(sourceManifest, commitSha);
    expect(previewManifest.name).toBe('Miteruyo Preview (0123456789ab)');
    expect(previewManifest.version).toBe('1.9.12');
    expect(Object.hasOwn(previewManifest, 'key')).toBe(false);
  });

  it('refuses a manifest key until its OAuth redirect is verified', () => {
    expect(() => createPreviewManifest({ name: 'Miteruyo', version: '1.9.12', key: 'unverified-key' }, commitSha)).toThrow(/redirect URI/);
  });

  it('builds an integrity-checked ZIP with only allowlisted files and explicit OAuth status', async () => {
    const outputDirectory = await mkdtemp(path.join(tmpdir(), 'miteruyo-preview-test-'));
    try {
      const result = await buildPreviewZip({ commitSha, outputDirectory, refName: 'preview' });
      const entries = execFileSync('unzip', ['-Z1', result.archivePath], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean)
        .filter(name => !name.endsWith('/'))
        .sort();
      expect(result.archiveName).toBe(`miteruyo-preview-${commitSha}.zip`);
      expect(entries).toEqual([...PREVIEW_FILES, PREVIEW_INFO_FILENAME].sort());
      const manifest = JSON.parse(execFileSync('unzip', ['-p', result.archivePath, 'manifest.json'], { encoding: 'utf8' }));
      const sourceManifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
      expect(manifest.name).toBe(`Miteruyo Preview (${commitSha.slice(0, 12)})`);
      expect(manifest.version).toBe(sourceManifest.version);
      expect(Object.hasOwn(manifest, 'key')).toBe(false);
      const info = execFileSync('unzip', ['-p', result.archivePath, PREVIEW_INFO_FILENAME], { encoding: 'utf8' });
      expect(info).toContain(`Source commit: ${commitSha}`);
      expect(info).toContain('OAuth status: NOT VERIFIED.');
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it('requires matching Client IDs in popup and background source', () => {
    expect(() => assertClientIdsMatch("const clientId = 'dev-id';", "const clientId = 'dev-id';")).not.toThrow();
    expect(() => assertClientIdsMatch("const clientId = 'first-id';", "const clientId = 'second-id';")).toThrow(/do not match/);
  });
});

describe('preview workflow separation', () => {
  it('refuses to build an artifact from a non-preview branch', async () => {
    await expect(buildPreviewZip({ commitSha, refName: 'main' })).rejects.toThrow(/preview branch/);
  });

  it('runs artifact upload only on preview pushes and does not read Actions secrets', () => {
    expect(previewWorkflow).toContain('branches: [preview]');
    expect(previewWorkflow).toContain('pull_request:');
    const uploadStep = previewWorkflow.split('      - name: Upload preview artifact\n')[1];
    expect(uploadStep).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/preview'");
    expect(previewWorkflow).toContain('actions/upload-artifact@v4');
    expect(previewWorkflow).toContain('name: miteruyo-preview-${{ github.sha }}');
    expect(previewWorkflow).toContain('path: dist/preview/miteruyo-preview-${{ github.sha }}.zip');
    expect(previewWorkflow).not.toMatch(/secrets\./i);
  });
});
