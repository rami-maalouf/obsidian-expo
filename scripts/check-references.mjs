import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = new Set(
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  }).split('\0').filter(Boolean),
);
const errors = [];
let links = 0;

for (const file of files) {
  if (!/\.(md|[cm]?[jt]sx?|json|ya?ml)$/.test(file)) continue;
  const body = readFileSync(resolve(root, file), 'utf8');
  const machinePath = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\|file:\/\/|~\/|\/private\/tmp\/)/;
  if (machinePath.test(body)) errors.push(`${file}: contains a machine-specific path`);
  if (!file.endsWith('.md')) continue;

  const markdown = body.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  for (const [, raw] of markdown.matchAll(/\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = raw.replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
      errors.push(`${file}: unsupported local reference ${target}`);
      continue;
    }
    let path;
    try {
      path = decodeURIComponent(target.split(/[?#]/)[0]);
    } catch {
      errors.push(`${file}: invalid URL encoding in ${target}`);
      continue;
    }
    const absolute = resolve(root, dirname(file), path);
    const local = relative(root, absolute);
    if (isAbsolute(path) || local === '..' || local.startsWith(`..${sep}`)) {
      errors.push(`${file}: reference leaves the repository: ${target}`);
      continue;
    }
    const gitPath = local.split(sep).join('/');
    const included = files.has(gitPath) || (
      existsSync(absolute) && statSync(absolute).isDirectory() &&
      [...files].some((entry) => entry.startsWith(`${gitPath}/`))
    );
    if (!included || !existsSync(absolute)) {
      errors.push(`${file}: missing or ignored reference: ${target}`);
    }
    links++;
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`checked ${links} local documentation links; no missing references or machine-specific paths`);
}
