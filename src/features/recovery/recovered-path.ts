/**
 * names for "keep both" recovery: the draft is written to a new note beside the original,
 * which stays untouched (persistence protocol).
 */
import type { CivilDateTime } from '@/features/templates/civil-time';

const pad = (value: number) => String(value).padStart(2, '0');

/** `Daily/2026-10-08.md` → `Daily/2026-10-08 (recovered 2026-10-08 0715).md`; attempt 2 adds ` 2`. */
export function recoveredNotePath(path: string, now: CivilDateTime, attempt = 1): string {
  const slash = path.lastIndexOf('/');
  const folder = slash === -1 ? '' : path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const base = name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
  const stamp = `${now.year}-${pad(now.month)}-${pad(now.day)} ${pad(now.hour)}${pad(now.minute)}`;
  const suffix = attempt > 1 ? ` ${attempt}` : '';
  return `${folder}${base} (recovered ${stamp}${suffix}).md`;
}
