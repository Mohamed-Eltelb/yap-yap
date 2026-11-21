import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Reads what a user brings from another dictation app: words, snippets, history, and settings.
 * Only fixed locations are read, read-only, and never audio, screenshots, or screen text.
 */

export type OtherAppId = 'wispr-flow' | 'typeless';
export type ImportedStyle = 'formal' | 'casual' | 'very-casual';

export interface OtherAppHistoryItem {
  createdAt: string;
  mode: 'dictate' | 'translate' | 'ask';
  text: string;
  rawText?: string;
  answer?: string;
  durationMs?: number;
  /** The app the text went to, as the other app named it. */
  application?: string;
  /** A language code such as "ar-EG", for translations. */
  targetLanguage?: string;
}

export interface OtherAppData {
  app: OtherAppId;
  name: string;
  words: { word: string; heardAs?: string; manual: boolean }[];
  snippets: { trigger: string; expansion: string }[];
  history: OtherAppHistoryItem[];
  settings: {
    /** Styles the user picked, by Yap Yap kind of place. "default" is for every other place. */
    styles?: Partial<Record<'Messaging' | 'Email' | 'default', ImportedStyle>>;
    cleanup?: 'none' | 'light' | 'medium';
    learnWords?: boolean;
  };
  /** What could not be brought over, in plain words. */
  notes: string[];
}

type Row = Record<string, unknown>;

const text = (value: unknown) => typeof value === 'string' ? value : undefined;

/** Wispr writes "2026-11-16 13:44:25.254 +00:00"; Typeless writes ISO. */
export function readDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const spaced = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d(?:\.\d+)?)\s*(Z|[+-]\d\d:?\d\d)?$/u.exec(value.trim());
  const time = Date.parse(spaced ? `${spaced[1]}T${spaced[2]}${spaced[3] ?? 'Z'}` : value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

const seconds = (value: unknown) => typeof value === 'number' && value > 0 ? Math.round(value * 1000) : undefined;

/** Opens a database read-only. A database another app has open in WAL mode is read from a copy. */
function openDatabase(file: string): { db: DatabaseSync; close: () => void } {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    db.prepare('select count(*) from sqlite_master').get();
    return { db, close: () => db.close() };
  } catch {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapyap-import-'));
    const copy = path.join(dir, path.basename(file));
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, copy + suffix);
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    return { db, close: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
  }
}

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`pragma table_info("${table}")`).all() as Row[]).map((row) => String(row.name)));
}

/** Selects the named columns that exist; a missing one reads as null, so a newer schema still imports. */
function select(db: DatabaseSync, table: string, wanted: string[], where = ''): Row[] {
  const have = columns(db, table);
  if (!have.size) throw new Error(`no ${table} table`);
  const list = wanted.map((name) => have.has(name) ? `"${name}"` : `null as "${name}"`).join(', ');
  return db.prepare(`select ${list} from "${table}" ${where}`).all() as Row[];
}

function readJson(file: string): Row | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Row;
  } catch {
    return undefined;
  }
}

const WISPR_STYLES: Record<string, ImportedStyle> = { formal: 'formal', casual: 'casual', 'very casual': 'very-casual', very_casual: 'very-casual', verycasual: 'very-casual' };

function wisprStyle(value: unknown): ImportedStyle | undefined {
  return typeof value === 'string' ? WISPR_STYLES[value.toLowerCase().replace(/-/gu, ' ').trim()] ?? WISPR_STYLES[value.toLowerCase()] : undefined;
}

export function readWisprFlow(dir: string): OtherAppData | undefined {
  const file = path.join(dir, 'flow.sqlite');
  if (!fs.existsSync(file)) return;
  const data: OtherAppData = { app: 'wispr-flow', name: 'Wispr Flow', words: [], snippets: [], history: [], settings: {}, notes: [] };
  const { db, close } = openDatabase(file);
  try {
    try {
      const where = columns(db, 'Dictionary').has('isDeleted') ? 'where coalesce("isDeleted", 0) = 0' : '';
      for (const row of select(db, 'Dictionary', ['phrase', 'replacement', 'isSnippet', 'manualEntry'], where)) {
        const phrase = text(row.phrase)?.trim();
        const replacement = text(row.replacement);
        if (!phrase) continue;
        if (Number(row.isSnippet) === 1) {
          if (replacement?.trim()) data.snippets.push({ trigger: phrase, expansion: replacement });
        } else if (replacement?.trim() && replacement.trim() !== phrase) {
          // A correction: Wispr replaces the phrase it hears with the replacement.
          data.words.push({ word: replacement.trim(), heardAs: phrase, manual: Number(row.manualEntry) === 1 });
        } else {
          data.words.push({ word: phrase, manual: Number(row.manualEntry) === 1 });
        }
      }
    } catch {
      data.notes.push('The Wispr Flow dictionary could not be read.');
    }
    try {
      const where = columns(db, 'History').has('isArchived') ? 'where coalesce("isArchived", 0) = 0' : '';
      for (const row of select(db, 'History', ['timestamp', 'asrText', 'formattedText', 'status', 'app', 'duration'], where)) {
        // Wispr's editedText is the text box after the paste, not the user's edit, so it is not used.
        const result = text(row.formattedText)?.trim() || text(row.asrText)?.trim();
        const createdAt = readDate(row.timestamp);
        if (!result || !createdAt || (row.status !== 'formatted' && row.status !== 'raw_transcript')) continue;
        data.history.push({
          createdAt,
          mode: 'dictate',
          text: result,
          rawText: text(row.asrText)?.trim() || undefined,
          durationMs: seconds(row.duration),
          application: text(row.app)?.trim() || undefined,
        });
      }
    } catch {
      data.notes.push('Wispr Flow history could not be read.');
    }
  } finally {
    close();
  }

  const user = (readJson(path.join(dir, 'config.json'))?.prefs as Row | undefined)?.user as Row | undefined;
  const picks = user?.personalizationStyles as Row | undefined;
  if (picks) {
    // Wispr splits messaging into personal and work. Yap Yap has one Messaging style: personal wins.
    const messaging = wisprStyle(picks.personal) ?? wisprStyle(picks.work);
    const styles = { Messaging: messaging, Email: wisprStyle(picks.email), default: wisprStyle(picks.other) };
    const set = Object.fromEntries(Object.entries(styles).filter(([, style]) => style));
    if (Object.keys(set).length) data.settings.styles = set;
    if (wisprStyle(picks.personal) && wisprStyle(picks.work) && wisprStyle(picks.personal) !== wisprStyle(picks.work)) {
      data.notes.push('Wispr Flow has different styles for personal and work messages. Yap Yap uses your personal one for all messaging.');
    }
    if (Object.values(picks).some((style) => typeof style === 'string' && /excited/iu.test(style))) {
      data.notes.push('Yap Yap has no Excited style, so those places keep learning from you.');
    }
  }
  const level = text((user?.autoCleanup as Row | undefined)?.level);
  if (level === 'none') data.settings.cleanup = 'none';
  else if (level === 'light') data.settings.cleanup = 'light';
  else if (level === 'medium' || level === 'high') data.settings.cleanup = 'medium';
  if (typeof user?.shouldAutoLearnWords === 'boolean') data.settings.learnWords = user.shouldAutoLearnWords;
  return data;
}

const TYPELESS_MODES: Record<string, OtherAppHistoryItem['mode']> = {
  voice_transcript: 'dictate',
  voice_translation: 'translate',
  voice_command: 'ask',
};

function parseMeta(value: unknown): Row | undefined {
  try {
    const raw = value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value;
    return typeof raw === 'string' ? JSON.parse(raw) as Row : undefined;
  } catch {
    return undefined;
  }
}

export function readTypeless(dir: string): OtherAppData | undefined {
  const file = path.join(dir, 'typeless.db');
  if (!fs.existsSync(file)) return;
  const data: OtherAppData = { app: 'typeless', name: 'Typeless', words: [], snippets: [], history: [], settings: {}, notes: [] };
  const { db, close } = openDatabase(file);
  try {
    for (const row of select(db, 'history_v2', ['created_at', 'mode', 'status', 'refined_text', 'duration', 'mode_meta'], `where "status" = 'completed'`)) {
      const mode = TYPELESS_MODES[text(row.mode) ?? 'voice_transcript'];
      const result = text(row.refined_text)?.trim();
      const createdAt = readDate(row.created_at);
      if (!mode || !result || !createdAt) continue;
      const meta = parseMeta(row.mode_meta);
      const ai = meta?.ai_result as Row | undefined;
      const question = text(ai?.user_prompt)?.trim();
      if (mode === 'ask' && !question) continue;
      data.history.push({
        createdAt,
        mode,
        text: result,
        ...(mode === 'ask' && { rawText: question, answer: result }),
        ...(mode === 'translate' && { targetLanguage: text(meta?.output_language) }),
        durationMs: seconds(row.duration),
      });
    }
  } catch {
    data.notes.push('Typeless history could not be read.');
  } finally {
    close();
  }
  data.notes.push('Typeless keeps your dictionary in your account, not on this computer. Add those words in Dictionary, or import them as a CSV.');
  return data;
}

/** The other dictation apps installed for this user, with what can be brought over. */
export function readOtherApps(appData: string): OtherAppData[] {
  const found: OtherAppData[] = [];
  const attempt = (read: () => OtherAppData | undefined) => {
    try {
      const data = read();
      if (data) found.push(data);
    } catch {
      // An app whose files can't be opened is left out rather than failing the others.
    }
  };
  attempt(() => readWisprFlow(path.join(appData, 'Wispr Flow')));
  // Typeless names its data folder after its executable on Windows.
  attempt(() => readTypeless(path.join(appData, 'Typeless.exe')) ?? readTypeless(path.join(appData, 'Typeless')));
  return found;
}
