/**
 * byte-level manifests for fixture vaults.
 *
 * a manifest records every file's relative path, size, and SHA-256 so tests can prove
 * that untouched files stay byte-identical. run directly to check or rewrite the
 * manifest of a fixture directory:
 *
 *   bun scripts/vault-manifest.ts tests/fixtures/vault-basic
 *   bun scripts/vault-manifest.ts tests/fixtures/vault-basic --write
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';

export const MANIFEST_FORMAT = 'obsidian-expo-vault-manifest/v1';

export type ManifestEntry = { path: string; bytes: number; sha256: string };

export type VaultManifest = {
  format: typeof MANIFEST_FORMAT;
  fileCount: number;
  totalBytes: number;
  /** SHA-256 over `sha256  bytes  path` lines, so one value identifies the whole vault. */
  digest: string;
  files: ManifestEntry[];
};

const encoder = new TextEncoder();

/** orders paths by UTF-8 bytes so the result does not depend on locale or UTF-16 order. */
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(encoder.encode(a), encoder.encode(b));
}

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function manifestFromEntries(entries: ManifestEntry[]): VaultManifest {
  const files = [...entries].sort((a, b) => compareUtf8(a.path, b.path));
  const digest = createHash('sha256');
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.bytes;
    digest.update(`${file.sha256}  ${file.bytes}  ${file.path}\n`);
  }
  return {
    format: MANIFEST_FORMAT,
    fileCount: files.length,
    totalBytes,
    digest: digest.digest('hex'),
    files,
  };
}

export function manifestEntry(path: string, data: Uint8Array): ManifestEntry {
  return { path, bytes: data.byteLength, sha256: sha256(data) };
}

/** builds a manifest for every regular file below `root`, with `/`-separated relative paths. */
export function buildManifest(root: string): VaultManifest {
  const entries: ManifestEntry[] = [];
  const visit = (dir: string) => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        visit(full);
      } else if (dirent.isFile()) {
        const path = relative(root, full).split(sep).join('/');
        entries.push(manifestEntry(path, readFileSync(full)));
      }
    }
  };
  visit(root);
  return manifestFromEntries(entries);
}

export function manifestPathFor(root: string): string {
  return `${root.replace(/[/\\]+$/, '')}.manifest.json`;
}

export function serializeManifest(manifest: VaultManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { write: { type: 'boolean', default: false } },
  });
  const root = positionals[0];
  if (!root) {
    console.error('Usage: bun scripts/vault-manifest.ts <vault-dir> [--write]');
    process.exit(2);
  }
  const manifest = buildManifest(root);
  const target = manifestPathFor(root);
  if (values.write) {
    writeFileSync(target, serializeManifest(manifest));
    console.log(`Wrote ${target}: ${manifest.fileCount} files, ${manifest.totalBytes} bytes`);
  } else {
    const recorded = JSON.parse(readFileSync(target, 'utf8')) as VaultManifest;
    if (recorded.digest !== manifest.digest) {
      console.error(`Manifest mismatch for ${root}. Run with --write only if the change is intended.`);
      process.exit(1);
    }
    console.log(`${root}: ${manifest.fileCount} files match ${target}`);
  }
}
