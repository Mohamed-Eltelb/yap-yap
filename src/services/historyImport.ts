import { HistoryItem, ProviderId } from '../types/app';
import { PROVIDER_CATALOG } from './providers/catalog';
import { classifyTranscriptCategory, countWords } from './stats';
import { parseWritingSample } from './personalization';

const categories = new Set(['AI assistants', 'Messaging', 'Social platforms', 'Development tools']);

export function assignHistoryIds(
  items: HistoryItem[],
  existingIds: Iterable<string> = [],
): HistoryItem[] {
  const idKey = (id: unknown) => typeof id === 'string' ? id.toLowerCase() : '';
  const used = new Set(Array.from(existingIds, idKey));
  const reserved = new Set(items.map((item) => idKey(item.id)));
  return items.map((item) => {
    const key = idKey(item.id);
    const safeId = /^[a-z0-9_-]{1,200}$/.test(key) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(key);
    if (safeId && !used.has(key)) {
      used.add(key);
      return item;
    }
    let id: string;
    do {
      id = `h-${crypto.randomUUID()}`;
    } while (used.has(id) || reserved.has(id));
    used.add(id);
    return { ...item, id };
  });
}

/**
 * Leaves out entries already in History (same time and text), and repeats within the file, so
 * importing the same export twice does not double what the app learned.
 */
export function skipDuplicateHistory<T extends Pick<HistoryItem, 'createdAt' | 'text'>>(
  items: readonly T[],
  existing: readonly Pick<HistoryItem, 'createdAt' | 'text'>[],
): T[] {
  const key = (item: Pick<HistoryItem, 'createdAt' | 'text'>) => `${Date.parse(item.createdAt) || item.createdAt}\n${item.text.trim()}`;
  const seen = new Set(existing.map(key));
  return items.filter((item) => {
    const itemKey = key(item);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

export function parseHistoryImport(source: string, defaultProvider: ProviderId): HistoryItem[] {
  const data: unknown = JSON.parse(source);
  if (!Array.isArray(data)) throw new Error('Choose a Yap Yap history JSON file.');
  const now = new Date().toISOString();
  return data.flatMap((item): HistoryItem[] => {
    if (!item || item.isSample || typeof item.text !== 'string' || !item.text.trim()) return [];
    const text = item.text.trim();
    const mode = item.mode === 'translate' || item.mode === 'ask' ? item.mode : 'dictate';
    const wordCount = countWords(text);
    const durationMs = Number.isFinite(item.durationMs) ? Math.max(400, item.durationMs) : 3000;
    return [{
      id: typeof item.id === 'string' ? item.id : '',
      text,
      rawText: typeof item.rawText === 'string' && item.rawText ? item.rawText : text,
      createdAt: typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
        ? new Date(item.createdAt).toISOString()
        : now,
      mode,
      durationMs,
      wordCount,
      wpm: Number.isFinite(item.wpm) && item.wpm > 0 ? item.wpm : Math.round(wordCount * 60_000 / durationMs),
      providerId: Object.hasOwn(PROVIDER_CATALOG, item.providerId) ? item.providerId : defaultProvider,
      model: typeof item.model === 'string' ? item.model : 'imported',
      answer: typeof item.answer === 'string' ? item.answer : undefined,
      searchedWeb: item.searchedWeb === true || undefined,
      targetLanguage: typeof item.targetLanguage === 'string' ? item.targetLanguage : undefined,
      flagged: item.flagged === true,
      category: categories.has(item.category) ? item.category : classifyTranscriptCategory(text, mode),
      writingSample: mode === 'dictate' ? parseWritingSample(item.writingSample) : undefined,
      writingCorrection: mode === 'dictate' && item.writingCorrection === true,
      writingCorrectedAt: mode === 'dictate' && item.writingCorrection === true && typeof item.writingCorrectedAt === 'string'
        && Number.isFinite(Date.parse(item.writingCorrectedAt)) ? new Date(item.writingCorrectedAt).toISOString() : undefined,
      writingSource: mode === 'dictate' && typeof item.writingSource === 'string' ? item.writingSource.trim().toLowerCase().slice(0, 100) || undefined : undefined,
      audioDataUrl: typeof item.audioDataUrl === 'string' && /^data:audio\/[\w.+-]+(?:;codecs=[\w.-]+)?;base64,[a-z0-9+/=]+$/i.test(item.audioDataUrl)
        ? item.audioDataUrl
        : undefined,
      audioMimeType: typeof item.audioMimeType === 'string' ? item.audioMimeType : undefined,
    }];
  });
}
