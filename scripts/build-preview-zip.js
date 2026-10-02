import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PREVIEW_INFO_FILENAME = 'PREVIEW-INFO.txt';
export const PREVIEW_FILES = Object.freeze([
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

const forbiddenPath = /(?:^|\/)\.env(?:\.[^/]+)?$|(?:^|\/)(?:id_rsa|id_ed25519|private[_-]?key)$|\.(?:pem|key|p12|pfx|jks|keystore)$/i;
const secretMarkers = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(?:TWITCH[_-]?)?(?:CLIENT|OAUTH)[_-]?SECRET\b\s*["']?\s*[:=]\s*(["'`])(?:(?!\1)[^\r\n]){8,}\1/i,
  /\b(?:access|refresh|oauth)[_-]?token\b\s*["']?\s*[:=]\s*(["'`])(?:(?!\1)[^\r\n]){16,}\1/i
];

export function assertSafePreviewInput(relativePath, content) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalizedPath) || normalizedPath.split('/').some(part => part === '.' || part === '..')) {
    throw new Error(`Unsafe preview input path: ${relativePath}`);
  }
  if (forbiddenPath.test(normalizedPath)) {
    throw new Error(`Sensitive preview input path: ${normalizedPath}`);
  }
  if (!PREVIEW_FILES.includes(normalizedPath)) {
    throw new Error(`Preview input is not allowlisted: ${normalizedPath}`);
  }

  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  if (secretMarkers.some(pattern => pattern.test(text))) {
    throw new Error(`Potential secret material in preview input: ${normalizedPath}`);
  }
  return normalizedPath;
}

export function createPreviewManifest(manifest, commitSha) {
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
    throw new Error('Preview build requires a full 40-character commit SHA.');
  }
  if (Object.hasOwn(manifest, 'key')) {
    throw new Error('Preview manifest key is not verified against the Twitch redirect URI.');
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('Preview manifest must contain a name and version.');
  }
  return {
    ...manifest,
    name: `${manifest.name} Preview (${commitSha.slice(0, 12)})`
  };
}

function getClientId(source) {
  const match = source.match(/^\s*const clientId = '([^']+)';\s*$/m);
  if (!match) {
    throw new Error('Could not find the checked-in development Client ID.');
  }
  return match[1];
}

export function assertClientIdsMatch(popupSource, backgroundSource) {
  if (getClientId(popupSource) !== getClientId(backgroundSource)) {
    throw new Error('Popup and background development Client IDs do not match.');
  }
}

function listArchiveFiles(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(name => !name.endsWith('/'))
    .sort();
}

export async function buildPreviewZip({
  root = repositoryRoot,
  commitSha = process.env.GITHUB_SHA,
  outputDirectory = process.env.PREVIEW_OUTPUT_DIR ?? 'dist/preview',
  refName = process.env.GITHUB_REF_NAME
} = {}) {
  if (!/^[a-f0-9]{40}$/i.test(commitSha ?? '')) {
    throw new Error('Preview build requires GITHUB_SHA to contain a full commit SHA.');
  }
  if (refName && refName !== 'preview') {
    throw new Error('Preview artifacts can only be built from the preview branch.');
  }

  const outputRoot = path.resolve(root, outputDirectory);
  const archiveName = `miteruyo-preview-${commitSha}.zip`;
  const archivePath = path.join(outputRoot, archiveName);
  await mkdir(outputRoot, { recursive: true });
  try {
    await lstat(archivePath);
    throw new Error(`Preview archive already exists: ${archiveName}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const stageRoot = await mkdtemp(path.join(tmpdir(), 'miteruyo-preview-'));
  try {
    let previewManifest;
    let popupSource;
    let backgroundSource;
    for (const relativePath of PREVIEW_FILES) {
      const sourcePath = path.join(root, relativePath);
      const sourceStat = await lstat(sourcePath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error(`Preview input must be a regular file: ${relativePath}`);
      }

      const sourceContent = await readFile(sourcePath);
      assertSafePreviewInput(relativePath, sourceContent);
      let stagedContent = sourceContent;
      if (relativePath === 'manifest.json') {
        const sourceManifest = JSON.parse(sourceContent.toString('utf8'));
        previewManifest = createPreviewManifest(sourceManifest, commitSha);
        stagedContent = Buffer.from(`${JSON.stringify(previewManifest, null, 2)}\n`);
      } else if (relativePath === 'popup.js') {
        popupSource = sourceContent.toString('utf8');
      } else if (relativePath === 'background-functions.js') {
        backgroundSource = sourceContent.toString('utf8');
      }

      const stagedPath = path.join(stageRoot, relativePath);
      await mkdir(path.dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, stagedContent);
    }
    assertClientIdsMatch(popupSource, backgroundSource);

    const info = [
      'Miteruyo Preview test archive',
      'Source branch: preview',
      `Source commit: ${commitSha}`,
      `Extension name: ${previewManifest.name}`,
      'Development Client ID: retained from checked-in source.',
      'Production Client ID secrets: not used.',
      'OAuth status: NOT VERIFIED.',
      'The source manifest has no public key, so this archive does not guarantee a shared extension ID.',
      'Before testing login, compare the installed extension redirect URL from chrome.identity.getRedirectURL()',
      'with the exact redirect URI already registered in the Twitch development application.',
      'ZIP generation does not confirm that Twitch OAuth succeeds.'
    ].join('\n') + '\n';
    await writeFile(path.join(stageRoot, PREVIEW_INFO_FILENAME), info);

    const expectedFiles = [...PREVIEW_FILES, PREVIEW_INFO_FILENAME].sort();
    const stagedFiles = (await listArchiveFilesFromDirectory(stageRoot)).sort();
    if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error('Preview staging directory does not match the allowlist.');
    }

    execFileSync('zip', ['-q', archivePath, ...expectedFiles], { cwd: stageRoot });
    execFileSync('unzip', ['-tq', archivePath], { stdio: 'pipe' });
    const archivedFiles = listArchiveFiles(archivePath);
    if (JSON.stringify(archivedFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error('Preview ZIP contents do not match the allowlist.');
    }
    return { archivePath, archiveName, previewName: previewManifest.name };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

function listArchiveFilesFromDirectory(directory) {
  const files = [];
  const visit = async relativeDirectory => {
    const absoluteDirectory = path.join(directory, relativeDirectory);
    for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error(`Unexpected entry in preview staging: ${relativePath}`);
      }
    }
  };
  return visit('').then(() => files);
}

async function main() {
  const result = await buildPreviewZip();
  console.log(`Created ${result.archivePath} (${result.previewName}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
