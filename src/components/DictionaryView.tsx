import React, { useMemo, useRef, useState } from 'react';
import { Feather, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { DictionaryEntry } from '../types/app';
import { WindowControls } from './YapLogo';

interface Props {
  entries: DictionaryEntry[];
  onAddWord: (word: string, source?: 'auto' | 'manual') => void;
  onImportWords: (words: string[]) => void;
  onDeleteWord: (id: string) => void;
}

type DictFilter = 'all' | 'auto' | 'manual';

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
  onDeleteWord,
}: Props) {
  const [filter, setFilter] = useState<DictFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newWord, setNewWord] = useState('');
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

  const handleSubmitWord = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newWord.trim();
    if (!cleaned) return;
    onAddWord(cleaned, 'manual');
    setNewWord('');
    setAddModalOpen(false);
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
    setAddModalOpen(false);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[var(--bg-main)] flex flex-col relative">
      {/* Top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-end px-3 pt-2 pb-1 app-drag">
        <WindowControls />
      </div>

      <div className="px-10 pb-10 pt-1 max-w-[980px] w-full mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-[28px] font-bold tracking-tight text-[var(--text-primary)]">
            Dictionary
          </h1>
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="px-4 py-2 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-[13px] font-semibold hover:opacity-90 transition-opacity shadow-xs"
          >
            New word
          </button>
        </div>

        {/* Filter Pills + Search */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="inline-flex items-center p-1 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3.5 py-1 rounded-full text-[12.5px] font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-[var(--bg-card-solid)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilter('auto')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[12.5px] font-medium transition-colors ${
                filter === 'auto'
                  ? 'bg-[var(--bg-card-solid)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-500" />
              <span>Auto-added</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('manual')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[12.5px] font-medium transition-colors ${
                filter === 'manual'
                  ? 'bg-[var(--bg-card-solid)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Feather className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span>Manually-added</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {searchOpen && (
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search words..."
                  className="w-48 pl-3 pr-7 py-1.5 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[12.5px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setSearchOpen((v) => !v);
                if (searchOpen) setSearchQuery('');
              }}
              aria-label="Search dictionary"
              className="w-8 h-8 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 3-Column Word Grid matching Image 5 */}
        {filtered.length === 0 ? (
          <div className="yy-card p-10 text-center text-[13.5px] text-[var(--text-secondary)]">
            No custom words found. Add names, technical terms, or URLs so every STT provider spells them accurately.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="group flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {entry.source === 'auto' ? (
                    <Sparkles className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                  ) : (
                    <Feather className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                  )}
                  <span
                    dir="auto"
                    className="text-[13px] font-medium text-[var(--text-primary)] truncate"
                  >
                    {entry.word}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteWord(entry.id)}
                  title="Remove word"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--bg-hover)] transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add to Dictionary Modal matching Image 6 */}
      {addModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setAddModalOpen(false)}
        >
          <form
            onSubmit={handleSubmitWord}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[460px] rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-2xl p-6"
          >
            <h2 className="text-[17px] font-semibold text-[var(--text-primary)] mb-4">
              Add to dictionary
            </h2>

            <input
              type="text"
              autoFocus
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder="Add a new word"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--text-primary)]/70 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/15"
            />

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
                className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-primary)] hover:opacity-75 transition-opacity"
              >
                <Upload className="w-4 h-4" />
                <span>Import CSV</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-[13px] font-semibold hover:opacity-90 transition-opacity"
                >
                  Add word
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
