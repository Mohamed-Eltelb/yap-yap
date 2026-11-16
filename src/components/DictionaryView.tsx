import React, { useMemo, useRef, useState } from 'react';
import { Check, Feather, Minus, MoreHorizontal, Pencil, Search, Sparkle, Trash2, Upload, X } from 'lucide-react';
import { DictionaryEntry } from '../types/app';
import { readHeardAs } from '../services/personalization';
import { WindowControls } from './YapLogo';

interface Props {
  entries: DictionaryEntry[];
  onAddWord: (word: string, source?: 'auto' | 'manual', heardAs?: string) => void;
  onImportWords: (words: string[]) => void;
  onEditWord: (id: string, word: string, heardAs?: string) => void;
  onDeleteWords: (ids: readonly string[]) => void;
}

type DictFilter = 'all' | 'auto' | 'manual';

const filters = [
  { id: 'all', label: 'All' },
  { id: 'auto', label: 'Auto-added', Icon: Sparkle },
  { id: 'manual', label: 'Manually-added', Icon: Feather },
] as const;

export function parseDictionaryImportText(raw: string): string[] {
  return raw
    .split(/[\r\n,;]+/)
    .map((s) => s.replace(/^["']|["']$/g, '').trim())
    .filter((s) => s.length > 0);
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
    const heard = readHeardAs(heardAs);
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
                  <span dir="auto" data-tooltip={entry.heardAs ? `${entry.word}, replaces “${entry.heardAs}”` : entry.word} className="flex-1 min-w-0 truncate text-sm">
                    {entry.word}
                    {entry.heardAs && <span className="yy-dictionary-heard"><span className="sr-only">, replaces </span>{entry.heardAs}</span>}
                  </span>
                  <div className="flex shrink-0 items-center gap-2" onBlur={(event) => {
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

            <input
              type="text"
              autoFocus
              value={newWord}
              onChange={(e) => { setNewWord(e.target.value); setWordError(''); }}
              placeholder={editingEntry ? 'Edit word' : 'Add a new word'}
              aria-label="Word"
              aria-invalid={Boolean(wordError)}
              aria-describedby={wordError ? 'dictionary-word-error' : undefined}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--text-primary)]/70 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/15"
            />

            {wordError && <p id="dictionary-word-error" role="alert" className="yy-dictionary-word-error mt-2 text-sm">{wordError}</p>}

            <label htmlFor="dictionary-heard-as" className="mt-4 block text-[13px] font-medium text-[var(--text-primary)]">
              Often written as <span className="font-normal text-[var(--text-secondary)]">(optional)</span>
            </label>
            <input
              id="dictionary-heard-as"
              type="text"
              maxLength={60}
              value={heardAs}
              onChange={(e) => { setHeardAs(e.target.value); setHeardAsError(''); }}
              placeholder="For example: hand of"
              aria-invalid={Boolean(heardAsError)}
              aria-describedby={heardAsError ? 'dictionary-heard-as-error' : 'dictionary-heard-as-help'}
              className="mt-1.5 w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-strong)] text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/15"
            />
            {heardAsError
              ? <p id="dictionary-heard-as-error" role="alert" className="yy-dictionary-word-error mt-2 text-sm">{heardAsError}</p>
              : <p id="dictionary-heard-as-help" className="mt-1.5 text-xs text-[var(--text-secondary)]">A spelling Yap Yap keeps getting wrong. It is always replaced with your word.</p>}

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleCsvSelect}
              className="hidden"
            />

            <div className="flex items-center justify-between mt-6">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                hidden={Boolean(editingEntry)}
                className="not-hidden:inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-primary)] hover:opacity-75 transition-opacity"
              >
                <Upload className="w-4 h-4" />
                <span>Import CSV</span>
              </button>

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
