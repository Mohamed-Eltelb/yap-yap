import { setTimeout as wait } from 'node:timers/promises';

export type RewritePasteResult = 'not-sent' | 'unverified' | 'confirmed';

export interface RewriteField {
  id: string;
  text: string;
  /** UTF-16 offset, or -1 if the editor doesn't expose a single selected range. */
  selectionStart: number;
}

const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, '\n');

/** Normalizes line endings and strips zero-width characters for reliable selection equality checks. */
export const normalizeSelectionText = (text: string) =>
  normalizeNewlines(text).replace(/[\u200b-\u200d\ufeff]/g, '');

/** Compute the expected field value while the highlight is still selected. */
export function expectedRewrite(field: RewriteField, original: string, replacement: string): string | undefined {
  const text = normalizeNewlines(field.text);
  const selected = normalizeNewlines(original);
  const inserted = normalizeNewlines(replacement);
  if (!selected || selected === inserted) return;

  let start = field.selectionStart;
  if (start < 0) {
    // For Copy-only editors, an unambiguous match is the only location we can confirm.
    start = text.indexOf(selected);
    if (start < 0 || text.indexOf(selected, start + 1) >= 0) return;
  } else {
    start = normalizeNewlines(field.text.slice(0, start)).length;
    if (!text.startsWith(selected, start)) return;
  }
  return text.slice(0, start) + inserted + text.slice(start + selected.length);
}

export async function confirmRewrite(
  field: RewriteField,
  expected: string,
  read: (timeoutMs: number) => Promise<RewriteField | undefined>,
): Promise<boolean> {
  const deadline = performance.now() + 650;
  while (performance.now() < deadline) {
    await wait(60);
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) return false;
    const current = await read(remaining);
    if (!current || current.id !== field.id) return false;
    if (normalizeNewlines(current.text) === expected) return true;
  }
  return false;
}
