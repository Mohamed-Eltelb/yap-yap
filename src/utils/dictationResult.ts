import type { DictationMode } from '../types/app';

export async function deliverDictationResult(
  mode: DictationMode,
  text: string,
  paste: ((text: string) => Promise<boolean>) | undefined,
  copy: (text: string) => Promise<void>,
): Promise<boolean> {
  if (mode !== 'ask' && paste) {
    try {
      if (await paste(text)) return true;
    } catch {
      // The result remains available even if desktop paste fails.
    }
  }
  try {
    await copy(text);
  } catch {
    // The user can retry from the result panel.
  }
  return false;
}
