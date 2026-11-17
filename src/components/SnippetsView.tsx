import React, { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react';
import type { Snippet } from '../types/app';
import { MAX_SNIPPET_EXPANSION, MAX_SNIPPET_TRIGGER, snippetTriggerKey } from '../services/personalization';
import { WindowControls } from './YapLogo';

interface Props {
  snippets: Snippet[];
  onAdd: (trigger: string, expansion: string) => void;
  onEdit: (id: string, trigger: string, expansion: string) => void;
  onDelete: (id: string) => void;
}

/** Saved text the user inserts by saying a trigger phrase while dictating. */
export function SnippetsView({ snippets, onAdd, onEdit, onDelete }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [form, setForm] = useState<'add' | Snippet | null>(null);
  const [trigger, setTrigger] = useState('');
  const [expansion, setExpansion] = useState('');
  const [triggerError, setTriggerError] = useState('');
  const [expansionError, setExpansionError] = useState('');
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const editing = form === 'add' ? null : form;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? snippets.filter((item) => item.trigger.toLowerCase().includes(needle) || item.expansion.toLowerCase().includes(needle))
      : snippets;
  }, [snippets, query]);

  const openForm = (next: 'add' | Snippet) => {
    setMenuId(null);
    setTrigger(next === 'add' ? '' : next.trigger);
    setExpansion(next === 'add' ? '' : next.expansion);
    setTriggerError('');
    setExpansionError('');
    setForm(next);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const cleanTrigger = trigger.replace(/\s+/g, ' ').trim();
    const key = snippetTriggerKey(cleanTrigger);
    if (!key) {
      setTriggerError('Enter a phrase to say, with at least one letter or number.');
      return;
    }
    if (snippets.some((item) => item.id !== editing?.id && snippetTriggerKey(item.trigger) === key)) {
      setTriggerError('Another snippet already uses this phrase.');
      return;
    }
    if (!expansion.trim()) {
      setExpansionError('Enter the text to insert.');
      return;
    }
    if (editing) onEdit(editing.id, cleanTrigger, expansion);
    else onAdd(cleanTrigger, expansion);
    setForm(null);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[var(--bg-main)] flex flex-col relative">
      <div className="sticky top-0 z-20 flex items-center justify-end px-3 pt-2 pb-1 app-drag">
        <WindowControls />
      </div>

      <div
        className="yy-dictionary w-full max-w-[1200px] mx-auto px-5 pb-10 pt-1 sm:px-6"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          if (menuId) setMenuId(null);
          else if (searchOpen) {
            closeSearch();
            requestAnimationFrame(() => searchButtonRef.current?.focus());
          }
        }}
      >
        <header className="flex items-center justify-between gap-3 mb-2">
          <h1 className="yy-page-title text-[clamp(28px,4vw,36px)] font-bold tracking-tight">Snippets</h1>
          <button
            type="button"
            onClick={() => openForm('add')}
            className="shrink-0 px-3.5 py-2 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-sm hover:opacity-90 transition-opacity"
          >
            New snippet
          </button>
        </header>
        <p className="mb-4 text-[13.5px] text-[var(--text-secondary)]">
          Say a snippet’s phrase while dictating, and Yap Yap inserts its text exactly as you saved it.
        </p>

        <div className="flex items-center justify-end mb-4 min-h-10">
          {searchOpen ? (
            <div className="yy-dictionary-search relative w-full sm:w-56">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" size={14} />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(event) => { setQuery(event.target.value); setMenuId(null); }}
                onBlur={(event) => {
                  if (!query && !event.currentTarget.parentElement?.contains(event.relatedTarget)) closeSearch();
                }}
                aria-label="Search snippets"
                placeholder="Search"
                className="w-full rounded-full bg-[var(--bg-main)] border border-[var(--border-strong)] py-1.5 pl-8 pr-8 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={(event) => { setQuery(''); event.currentTarget.parentElement?.querySelector('input')?.focus(); }}
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
              aria-label="Search snippets"
              className="size-8 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Search size={14} />
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-[13.5px] text-[var(--text-secondary)]">
            {snippets.length ? 'No snippets match your search.' : 'Save text you type often, like your email signature or a meeting link.'}
          </p>
        ) : (
          <ul className="yy-snippet-grid grid gap-3">
            {filtered.map((item) => {
              const menuOpen = menuId === item.id;
              return (
                <li key={item.id} className="yy-snippet group relative rounded-xl">
                  <div className="flex items-start gap-2">
                    <strong dir="auto" className="yy-snippet-trigger flex-1 min-w-0 truncate">“{item.trigger}”</strong>
                    <div
                      className="yy-dictionary-actions relative flex shrink-0 items-center"
                      data-keep={menuOpen || undefined}
                      onBlur={(event) => {
                        if (menuOpen && !event.currentTarget.contains(event.relatedTarget)) setMenuId(null);
                      }}
                    >
                      <button
                        type="button"
                        aria-label={`Actions for ${item.trigger}`}
                        aria-expanded={menuOpen}
                        onClick={() => setMenuId(menuOpen ? null : item.id)}
                        className="yy-dictionary-row-action yy-dictionary-menu-trigger"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                      {menuOpen && (
                        <div className="yy-dictionary-menu">
                          <button type="button" onClick={() => openForm(item)}>
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button type="button" className="yy-dictionary-menu-delete" onClick={() => { onDelete(item.id); setMenuId(null); }}>
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <p dir="auto" className="yy-snippet-expansion">{item.expansion}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {form && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setForm(null)}
        >
          <form
            onSubmit={submit}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === 'Escape') setForm(null); }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="snippet-form-title"
            className="w-full max-w-[520px] rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-2xl p-6"
          >
            <h2 id="snippet-form-title" className="text-[17px] font-semibold text-[var(--text-primary)] mb-4">
              {editing ? 'Edit snippet' : 'New snippet'}
            </h2>

            <label htmlFor="snippet-trigger" className="block text-[13px] font-medium text-[var(--text-primary)]">When you say</label>
            <input
              id="snippet-trigger"
              type="text"
              autoFocus
              maxLength={MAX_SNIPPET_TRIGGER}
              value={trigger}
              onChange={(event) => { setTrigger(event.target.value); setTriggerError(''); }}
              placeholder="my email signature"
              aria-invalid={Boolean(triggerError)}
              aria-describedby={triggerError ? 'snippet-trigger-error' : 'snippet-trigger-help'}
              className="mt-1.5 w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--text-primary)]/70 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/15"
            />
            {triggerError
              ? <p id="snippet-trigger-error" role="alert" className="yy-dictionary-word-error mt-2 text-sm">{triggerError}</p>
              : <p id="snippet-trigger-help" className="mt-1.5 text-xs text-[var(--text-secondary)]">Pick a phrase you don’t otherwise say. It is replaced wherever it appears in a dictation.</p>}

            <label htmlFor="snippet-expansion" className="mt-4 block text-[13px] font-medium text-[var(--text-primary)]">Insert</label>
            <textarea
              id="snippet-expansion"
              rows={5}
              maxLength={MAX_SNIPPET_EXPANSION}
              value={expansion}
              onChange={(event) => { setExpansion(event.target.value); setExpansionError(''); }}
              placeholder="The text to insert, line breaks and all"
              aria-invalid={Boolean(expansionError)}
              aria-describedby={expansionError ? 'snippet-expansion-error' : undefined}
              className="mt-1.5 w-full resize-y px-3.5 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-strong)] text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/15"
            />
            {expansionError && <p id="snippet-expansion-error" role="alert" className="yy-dictionary-word-error mt-2 text-sm">{expansionError}</p>}

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="px-4 py-2 rounded-full border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-[13px] font-semibold hover:opacity-90 transition-opacity"
              >
                {editing ? 'Save' : 'Add snippet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
