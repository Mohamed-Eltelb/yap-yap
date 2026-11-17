import React, { useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Feather, Minus, MoreHorizontal, Pencil, Search, Sparkle, Trash2, Upload, X } from 'lucide-react';
import { DictionaryEntry } from '../types/app';
import { readHeardAs } from '../services/personalization';
import { WindowControls } from './YapLogo';
import { Toggle } from './Toggle';

interface Props {
  entries: DictionaryEntry[];
  onAddWord: (word: string, source?: 'auto' | 'manual', heardAs?: string) => void;
  onImportWords: (words: ImportedWord[]) => void;
  onEditWord: (id: string, word: string, heardAs?: string) => void;
  onDeleteWords: (ids: readonly string[]) => void;
}

type DictFilter = 'all' | 'auto' | 'manual';

const filters = [
  { id: 'all', label: 'All' },
  { id: 'auto', label: 'Auto-added', Icon: Sparkle },
  { id: 'manual', label: 'Manually-added', Icon: Feather },
] as const;

export interface ImportedWord {
  word: string;
  heardAs?: string;
}

const unquote = (field: string) => field.trim().replace(/^["']|["']$/g, '').replace(/""/g, '"').trim();

/** Splits one CSV line on commas or semicolons outside quotes. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    if ((char === ',' || char === ';') && !quoted) {
      fields.push(current);
      current = '';
    } else current += char;
  }
  fields.push(current);
  return fields.map(unquote);
}

const WORD_HEADER = /^(?:word|words|phrase|term|correct(?: spelling)?|replace(?:ment| with)?|to)$/i;
const HEARD_HEADER = /^(?:heard as|often written as|misspelling|misspelled|wrong(?: spelling)?|incorrect|from|original)$/i;
/** "hand of -> handoff" or "hand of → handoff": the wrong spelling, then the word. */
const ARROW = /\s*(?:->|=>|→)\s*/;

/**
 * Words from a CSV or text file: one or more per line, split by commas or semicolons. A line
 * "hand of -> handoff", or a file with a header row naming a word column and a heard-as column,
 * also sets the spelling each word replaces.
 */
export function parseDictionaryImportText(raw: string): ImportedWord[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = lines.length ? csvFields(lines[0]) : [];
  const wordColumn = header.findIndex((field) => WORD_HEADER.test(field));
  const heardColumn = header.findIndex((field) => HEARD_HEADER.test(field));
  const columns = wordColumn >= 0 && heardColumn >= 0;

  const entries = (columns ? lines.slice(1) : lines).flatMap((line): ImportedWord[] => {
    if (columns) {
      const fields = csvFields(line);
      const word = fields[wordColumn] ?? '';
      const heardAs = readHeardAs(fields[heardColumn]);
      return word ? [{ word, ...(heardAs && heardAs.toLowerCase() !== word.toLowerCase() && { heardAs }) }] : [];
    }
    const arrow = line.split(ARROW);
    if (arrow.length === 2) {
      const word = unquote(arrow[1]);
      const heardAs = readHeardAs(unquote(arrow[0]));
      if (word) return [{ word, ...(heardAs && heardAs.toLowerCase() !== word.toLowerCase() && { heardAs }) }];
    }
    return csvFields(line).filter(Boolean).map((word) => ({ word }));
  });
  // A word listed twice keeps its first spelling to replace.
  const seen = new Set<string>();
  return entries.filter(({ word }) => !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()));
}

export function DictionaryView({
  entries,
  onAddWord,
  onImportWords,
  onEditWord,
  onDeleteWords,
}: Props) {
  const [filter, setFilter] = useState<DictFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const [wordForm, setWordForm] = useState<'add' | DictionaryEntry | null>(null);
  const [newWord, setNewWord] = useState('');
  const [heardAs, setHeardAs] = useState('');
  /** Whether the word replaces a spelling Yap Yap keeps getting wrong. */
  const [correcting, setCorrecting] = useState(false);
  const heardAsRef = useRef<HTMLInputElement>(null);
  const [wordError, setWordError] = useState('');
  const [heardAsError, setHeardAsError] = useState('');
  const editingEntry = wordForm === 'add' ? null : wordForm;
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filter !== 'all' && e.source !== filter) return false;
      if (searchQuery.trim()) {
        return e.word.toLowerCase().includes(searchQuery.trim().toLowerCase());
      }
      return true;
    });
  }, [entries, filter, searchQuery]);

  const selected = filtered.filter((entry) => selectedIds.has(entry.id));
  const selecting = selected.length > 0;
  const allSelected = selecting && selected.length === filtered.length;

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setMenuId(null);
  };

  const deleteSelected = () => {
    onDeleteWords(selected.map((entry) => entry.id));
    setSelectedIds(new Set());
  };

  const openWordForm = (form: 'add' | DictionaryEntry) => {
    setMenuId(null);
    setNewWord(form === 'add' ? '' : form.word);
    setHeardAs(form === 'add' ? '' : form.heardAs ?? '');
    setCorrecting(form !== 'add' && Boolean(form.heardAs));
    setWordError('');
    setHeardAsError('');
    setWordForm(form);
  };

  const handleSubmitWord = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newWord.trim();
    if (!cleaned) return;
    if (entries.some((entry) => entry.id !== editingEntry?.id && entry.word.toLowerCase() === cleaned.toLowerCase())) {
      setWordError('This word is already in your dictionary.');
      return;
    }
    const heard = correcting ? readHeardAs(heardAs) : undefined;
    if (correcting && !heard) {
      setHeardAsError('Enter the misspelling, or turn off Correct a misspelling.');
      return;
    }
    if (heard && heard.toLowerCase() === cleaned.toLowerCase()) {
      setHeardAsError('Enter how Yap Yap gets it wrong, not the word itself.');
      return;
    }
    if (heard && entries.some((entry) => entry.id !== editingEntry?.id
      && (entry.word.toLowerCase() === heard.toLowerCase() || entry.heardAs?.toLowerCase() === heard.toLowerCase()))) {
      setHeardAsError('Another word in your dictionary already uses this spelling.');
      return;
    }
    if (editingEntry) onEditWord(editingEntry.id, cleaned, heard);
    else onAddWord(cleaned, 'manual', heard);
    setWordForm(null);
  };

  const handleCsvSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const words = parseDictionaryImportText(text);
    if (words.length > 0) {
      onImportWords(words);
    }
    e.target.value = '';
    setWordForm(null);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[var(--bg-main)] flex flex-col relative">
      {/* Top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-end px-3 pt-2 pb-1 app-drag">
        <WindowControls />
      </div>

      <div className="yy-dictionary w-full max-w-[1200px] mx-auto px-5 pb-10 pt-1 sm:px-6"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          if (menuId) setMenuId(null);
          else if (selecting) setSelectedIds(new Set());
          else if (searchOpen) {
            closeSearch();
            requestAnimationFrame(() => searchButtonRef.current?.focus());
          }
        }}
      >
        <header className="flex items-center justify-between gap-3 mb-5">
          <h1 className="yy-page-title text-[clamp(28px,4vw,36px)] font-bold tracking-tight">Dictionary</h1>
          <button
            type="button"
            onClick={() => openWordForm('add')}
            className="shrink-0 px-3.5 py-2 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-sm hover:opacity-90 transition-opacity"
          >
            New word
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 min-h-10">
          {selecting ? (
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-2.5 px-2">
                <span className="yy-dictionary-checkbox relative">
                  <input
                    type="checkbox"
                    aria-label="Select all visible words"
                    checked={allSelected}
                    ref={(input) => { if (input) input.indeterminate = !allSelected; }}
                    onChange={(event) => setSelectedIds(new Set(event.target.checked ? filtered.map((entry) => entry.id) : []))}
                  />
                  {allSelected ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}
                </span>
                <span role="status">{selected.length} {selected.length === 1 ? 'word' : 'words'} selected</span>
              </label>
              <button type="button" onClick={deleteSelected} className="yy-dictionary-delete">
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          ) : (
            <>
              <div className="yy-dictionary-filters inline-flex items-center p-1 rounded-full" aria-label="Filter dictionary">
                {filters.map(({ id, label, ...item }) => {
                  const Icon = 'Icon' in item ? item.Icon : null;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={filter === id}
                      onClick={() => { setFilter(id); setMenuId(null); }}
                      className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-[13px] whitespace-nowrap transition-colors"
                    >
                      {Icon && <Icon aria-hidden="true" size={13} className={id === 'auto' ? 'yy-dictionary-auto' : 'yy-dictionary-manual'} />}
                      {label}
                    </button>
                  );
                })}
              </div>

              {searchOpen ? (
                <div className="yy-dictionary-search relative w-full sm:w-56">
                  <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" size={14} />
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(event) => { setSearchQuery(event.target.value); setMenuId(null); }}
                    onBlur={(event) => {
                      if (!searchQuery && !event.currentTarget.parentElement?.contains(event.relatedTarget)) closeSearch();
                    }}
                    aria-label="Search words"
                    placeholder="Search"
                    className="w-full rounded-full bg-[var(--bg-main)] border border-[var(--border-strong)] py-1.5 pl-8 pr-8 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={(event) => { setSearchQuery(''); event.currentTarget.parentElement?.querySelector('input')?.focus(); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  ref={searchButtonRef}
                  type="button"
                  onClick={() => { setSearchOpen(true); setMenuId(null); }}
                  aria-label="Search dictionary"
                  className="ml-auto size-8 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Search size={14} />
                </button>
              )}
            </>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-[13.5px] text-[var(--text-secondary)]">
            {entries.length ? 'No words match your filters.' : 'Add names, technical terms, or URLs to your dictionary.'}
          </p>
        ) : (
          <ul className="yy-dictionary-grid grid gap-x-1.5 gap-y-3">
            {filtered.map((entry) => {
              const checked = selectedIds.has(entry.id);
              const menuOpen = menuId === entry.id;
              const Icon = entry.source === 'auto' ? Sparkle : Feather;

              return (
                <li key={entry.id} className="yy-dictionary-word group relative flex min-w-0 items-center gap-2 px-3 rounded-xl" data-selected={checked}>
                  <Icon aria-hidden="true" size={13} className={entry.source === 'auto' ? 'yy-dictionary-auto shrink-0' : 'yy-dictionary-manual shrink-0'} />
                  <span data-tooltip={entry.heardAs ? `${entry.word}, replaces “${entry.heardAs}”` : entry.word} className="flex flex-1 min-w-0 items-center gap-1.5 text-sm">
                    <span dir="auto" className="min-w-0 truncate">{entry.word}</span>
                    {entry.heardAs && <span dir="auto" className="yy-dictionary-heard"><span className="sr-only">, replaces </span>{entry.heardAs}</span>}
                  </span>
                  {/* Hidden actions take no room, so the word gets the whole row until hover or focus. */}
                  <div className="yy-dictionary-actions flex shrink-0 items-center gap-2" data-keep={selecting || menuOpen || undefined} onBlur={(event) => {
                    if (menuOpen && !event.currentTarget.contains(event.relatedTarget)) setMenuId(null);
                  }}>
                    {!selecting && (
                      <button
                        type="button"
                        aria-label={`Actions for ${entry.word}`}
                        aria-expanded={menuOpen}
                        onClick={() => setMenuId(menuOpen ? null : entry.id)}
                        className="yy-dictionary-row-action yy-dictionary-menu-trigger"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    )}
                    <span className={`yy-dictionary-checkbox relative ${selecting ? '' : 'yy-dictionary-row-action'}`}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.word}`}
                        checked={checked}
                        onChange={(event) => toggleSelected(entry.id, event.target.checked)}
                      />
                      {checked && <Check aria-hidden="true" />}
                    </span>
                    {menuOpen && !selecting && (
                      <div className="yy-dictionary-menu">
                        <button type="button" onClick={() => openWordForm(entry)}>
                          <Pencil size={14} />
                          Edit
                        </button>
                        <button type="button" className="yy-dictionary-menu-delete" onClick={() => { onDeleteWords([entry.id]); setMenuId(null); }}>
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {wordForm && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setWordForm(null)}
        >
          <form
            onSubmit={handleSubmitWord}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => { if (event.key === 'Escape') setWordForm(null); }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dictionary-word-form-title"
            className="w-full max-w-[460px] rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-2xl p-6"
          >
            <h2 id="dictionary-word-form-title" className="text-[17px] font-semibold text-[var(--text-primary)] mb-4">
              {editingEntry ? 'Edit word' : 'Add to dictionary'}
            </h2>

            <div className="mb-4 flex items-center justify-between gap-4">
              <span className="text-[13.5px] text-[var(--text-primary)]">Correct a misspelling</span>
              <Toggle
                label="Correct a misspelling"
                checked={correcting}
                onChange={(on) => {
                  setCorrecting(on);
                  setHeardAsError('');
                  if (on) requestAnimationFrame(() => heardAsRef.current?.focus());
                }}
              />
            </div>

            <div className="flex items-center gap-2">
              {correcting && (
                <>
                  <input
                    ref={heardAsRef}
                    type="text"
                    maxLength={60}
                    value={heardAs}
                    onChange={(e) => { setHeardAs(e.target.value); setHeardAsError(''); }}
                    placeholder="Misspelling"
                    aria-label="Misspelling"
                    aria-invalid={Boolean(heardAsError)}
                    aria-describedby={heardAsError ? 'dictionary-heard-as-error' : 'dictionary-heard-as-help'}
                    className="min-w-0 flex-1 px-3.5 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-strong)] text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/15"
                  />
                  <ArrowRight aria-hidden="true" size={16} className="shrink-0 text-[var(--text-secondary)]" />
                </>
              )}
              <input
                type="text"
                autoFocus
                value={newWord}
                onChange={(e) => { setNewWord(e.target.value); setWordError(''); }}
                placeholder={correcting ? 'Correct spelling' : editingEntry ? 'Edit word' : 'Add a new word'}
                aria-label={correcting ? 'Correct spelling' : 'Word'}
                aria-invalid={Boolean(wordError)}
                aria-describedby={wordError ? 'dictionary-word-error' : undefined}
                className="min-w-0 flex-1 px-3.5 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--text-primary)]/70 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/15"
              />
            </div>

            {wordError && <p id="dictionary-word-error" role="alert" className="yy-dictionary-word-error mt-2 text-sm">{wordError}</p>}
            {correcting && (heardAsError
              ? <p id="dictionary-heard-as-error" role="alert" className="yy-dictionary-word-error mt-2 text-sm">{heardAsError}</p>
              : <p id="dictionary-heard-as-help" className="mt-2 text-xs text-[var(--text-secondary)]">Whenever Yap Yap writes the misspelling, it writes your word instead.</p>)}

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleCsvSelect}
              className="hidden"
            />

            <div className="flex items-center justify-between mt-6">
              {!editingEntry && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="One word per line. To replace a spelling, write it as: hand of -> handoff"
                  className="-ml-3 inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Upload aria-hidden="true" className="size-4 shrink-0" />
                  Import CSV
                </button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWordForm(null)}
                  className="px-4 py-2 rounded-full border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-[13px] font-semibold hover:opacity-90 transition-opacity"
                >
                  {editingEntry ? 'Save' : 'Add word'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
