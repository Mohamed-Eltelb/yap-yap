export interface FocusedField {
  /** Identity of the focused control, so edits elsewhere are never read as corrections. */
  field: string;
  text: string;
}

const squash = (text: string) => text.replace(/\s+/gu, ' ').trim();
const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/** The part of `current` that now sits where the pasted text was, found by its neighbours. */
function pastedRegion(pasted: string, atPaste: string, current: string): string | undefined {
  const start = atPaste.lastIndexOf(pasted);
  if (start < 0) return;
  const lead = atPaste.slice(Math.max(0, start - 24), start);
  const trail = atPaste.slice(start + pasted.length, start + pasted.length + 24);
  const from = lead ? current.lastIndexOf(lead) : 0;
  if (from < 0) return;
  const regionStart = from + lead.length;
  const to = trail ? current.indexOf(trail, regionStart) : current.length;
  if (to < 0) return;
  return current.slice(regionStart, to);
}

/**
 * Words the user respelled inside text that was just pasted, such as "super base" → "Supabase".
 * Returns undefined when the pasted text can no longer be located, and nothing for rewrites.
 */
export function extractCorrections(pastedText: string, textAtPaste: string, textNow: string): string[] | undefined {
  const pasted = squash(pastedText);
  const region = pasted && pastedRegion(pasted, squash(textAtPaste), squash(textNow));
  if (region === undefined || region === '') return;
  const before = pasted.split(' ');
  const after = region.split(' ');
  if (before.length > 400 || after.length > 600) return;

  // Longest common subsequence of words, then read the gaps between matches as replacements.
  const key = (word: string) => bare(word).toLowerCase();
  const lcs = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i][j] = bare(before[i]) === bare(after[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const learned: string[] = [];
  let changed = 0;
  let replacements = 0;
  for (let i = 0, j = 0; i < before.length || j < after.length;) {
    if (i < before.length && j < after.length && bare(before[i]) === bare(after[j])) { i++; j++; continue; }
    const oldStart = i;
    const newStart = j;
    while (i < before.length || j < after.length) {
      if (i < before.length && j < after.length && bare(before[i]) === bare(after[j])) break;
      if (j >= after.length || (i < before.length && lcs[i + 1][j] >= lcs[i][j + 1])) i++;
      else j++;
    }
    const removed = before.slice(oldStart, i);
    const added = after.slice(newStart, j).map(bare).filter(Boolean);
    changed += removed.length;
    if (!removed.length || added.length !== 1 || removed.length > 2) continue;
    replacements++;
    const word = added[0];
    const from = removed.map(key).join('');
    const to = word.toLowerCase();
    // A case-only change is learned only when the casing is distinctive (GitHub, API), so a
    // capitalized sentence start is not mistaken for a name.
    const distinctive = from === to ? /^.+\p{Lu}/u.test(word) : editDistance(from, to) <= Math.max(from.length, to.length) / 2;
    if (distinctive && word.length >= 3 && word.length <= 40 && /\p{L}/u.test(word) && !learned.includes(word)) learned.push(word);
  }
  const rewrite = before.length >= 5 ? changed > before.length * 0.4 : replacements > 1;
  return rewrite ? [] : learned.slice(0, 3);
}

let finishWatch: (() => void) | undefined;

/**
 * Watches the field that was just pasted into and resolves with the words the user corrected.
 * Stops when focus leaves the field, a new paste starts, or the window closes. Field text is
 * compared in memory only.
 */
export async function watchPasteCorrections(
  pastedText: string,
  readField: () => Promise<FocusedField | undefined>,
  { settleMs = 400, intervalMs = 1500, windowMs = 30_000 } = {},
): Promise<string[]> {
  finishWatch?.();
  let finished = false;
  let wake: (() => void) | undefined;
  finishWatch = () => { finished = true; wake?.(); };
  const pause = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  });

  await pause(settleMs);
  const first = finished ? undefined : await readField();
  if (!first || !squash(first.text).includes(squash(pastedText))) return [];

  let corrections: string[] = [];
  let previous = first.text;
  for (const deadline = Date.now() + windowMs; !finished && Date.now() < deadline;) {
    await pause(intervalMs);
    if (finished) break;
    const current = await readField();
    if (!current || current.field !== first.field) break;
    // Two identical reads in a row mean the user is not mid-word.
    if (current.text === previous) corrections = extractCorrections(pastedText, first.text, current.text) ?? corrections;
    previous = current.text;
  }
  return corrections;
}
