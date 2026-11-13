import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AudioLines, Check, GripVertical, Trash2, X } from 'lucide-react';
import {
  getLanguageVariant,
  LANGUAGE_VARIANTS,
  setLanguageVariant,
  TRANSLATION_LANGUAGES,
} from '../data/languages';
import { SelectMenu } from './SelectMenu';

function LanguageDialog({ title, description, children, onClose }: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="yy-language-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
    >
      <button type="button" autoFocus aria-label={`Close ${title.toLowerCase()}`} className="yy-language-close" onClick={onClose}>
        <X size={18} />
      </button>
      <header>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
      </header>
      {children}
    </dialog>
  );
}

export function TranslationTargetsDialog({ targets, onChange, onClose }: {
  targets: string[];
  onChange: (targets: string[]) => void;
  onClose: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const searchPanel = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const targetList = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const canAdd = targets.length < 3;
  const needle = query.trim().toLocaleLowerCase();
  const matches = [
    ...targets.map((name) => [name, TRANSLATION_LANGUAGES.find(([label]) => label === name)?.[1] ?? name] as const),
    ...TRANSLATION_LANGUAGES.filter(([name]) => !targets.includes(name)),
  ].filter(([name, native]) => [name, native].some((label) => label.toLocaleLowerCase().includes(needle)));

  useLayoutEffect(() => {
    if (!searching) return;
    searchField.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!searchPanel.current?.contains(event.target as Node)) setSearching(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [searching]);

  useLayoutEffect(() => {
    if (searching) results.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [searching, active, query]);

  const closeSearch = (focusList = false) => {
    setSearching(false);
    requestAnimationFrame(() => (focusList ? targetList.current : addButton.current)?.focus());
  };

  const choose = (name: string) => {
    const selected = targets.includes(name);
    if (selected && targets.length > 1) onChange(targets.filter((target) => target !== name));
    if (!selected && canAdd) onChange([...targets, name]);
    closeSearch(!selected && targets.length === 2);
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= targets.length) return;
    const next = [...targets];
    const [target] = next.splice(from, 1);
    next.splice(to, 0, target);
    onChange(next);
  };

  const clearDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <LanguageDialog
      title="Translation targets"
      description="Choose up to 3 target languages for your dictation in translation mode."
      onClose={onClose}
    >
      <div className="yy-translation-preview" aria-hidden="true">
        <div className="yy-preview-label">Translating to</div>
        <div className="yy-preview-menu">
          <div>Add another language</div>
          {(targets.length ? targets : ['English (US)']).map((name, index) => (
            <span key={name} data-primary={index === 0}>{name}</span>
          ))}
        </div>
        <div className="yy-preview-hud"><X size={14} /><AudioLines size={22} /><Check size={16} /></div>
      </div>
      <div className="yy-language-body">
        <div className="yy-target-list" ref={targetList} tabIndex={-1} role="group" aria-label="Selected translation targets">
          {targets.map((name, index) => (
            <div
              className="yy-target-row"
              key={name}
              draggable={targets.length > 1}
              data-drag-over={dragOver === index && dragFrom !== index}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', name);
                setDragFrom(index);
              }}
              onDragEnd={clearDrag}
              onDragOver={(event) => {
                if (dragFrom === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOver(index);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(null);
              }}
              onDrop={(event) => {
                if (dragFrom === null) return;
                event.preventDefault();
                move(dragFrom, index);
                clearDrag();
              }}
            >
              <button
                type="button"
                className="yy-target-grip"
                aria-label={`Reorder ${name} with the up and down arrow keys`}
                disabled={targets.length < 2}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault();
                  const grip = event.currentTarget;
                  move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                  requestAnimationFrame(() => grip.focus());
                }}
              ><GripVertical size={15} /></button>
              <span>{name}</span>
              {targets.length > 1 && (
                <button
                  type="button"
                  className="yy-target-remove"
                  aria-label={`Remove ${name}`}
                  onClick={() => {
                    onChange(targets.filter((target) => target !== name));
                    requestAnimationFrame(() => addButton.current?.focus());
                  }}
                ><Trash2 size={15} /></button>
              )}
            </div>
          ))}
          {canAdd && !searching && (
            <button
              ref={addButton}
              type="button"
              className="yy-target-add"
              onClick={() => {
                setQuery('');
                setActive(0);
                setSearching(true);
              }}
            >Add another language</button>
          )}
        </div>
        {searching && (
          <div ref={searchPanel} className="yy-target-search">
            <div className="yy-target-search-field">
              <input
                ref={searchField}
                role="combobox"
                aria-label="Search language"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={resultsId}
                aria-activedescendant={matches[active] ? `${resultsId}-${active}` : undefined}
                placeholder="Search language"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeSearch();
                  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    setActive(Math.max(0, Math.min(matches.length - 1, active + step)));
                  } else if (event.key === 'Enter' && matches[active]) {
                    event.preventDefault();
                    choose(matches[active][0]);
                  }
                }}
              />
              <button type="button" aria-label="Close language search" onClick={() => closeSearch()}><X size={18} /></button>
            </div>
            <div ref={results} id={resultsId} role="listbox" aria-label="Translation languages" aria-multiselectable="true" className="yy-target-results">
              {matches.map(([name, native], index) => {
                const selected = targets.includes(name);
                return (
                  <div
                    key={name}
                    id={`${resultsId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={selected && targets.length === 1}
                    data-active={index === active}
                    className="yy-target-result"
                    onPointerMove={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(name)}
                  >
                    <div><span dir="auto">{native}</span><small>{name}</small></div>
                    {selected && <Check size={15} className="yy-option-check" aria-hidden="true" />}
                  </div>
                );
              })}
              {matches.length === 0 && <p role="status">No languages found.</p>}
            </div>
          </div>
        )}
      </div>
    </LanguageDialog>
  );
}

export function LanguageVariantsDialog({ variants, onChange, onClose }: {
  variants: string[];
  onChange: (variants: string[]) => void;
  onClose: () => void;
}) {
  const tipId = useId();
  const [showHelp, setShowHelp] = useState(false);

  return (
    <LanguageDialog
      title="Language variants"
      description="Choose your preferred variant for each language you use in dictation (e.g., US English or UK English)."
      onClose={onClose}
    >
      <div className="yy-language-body yy-variant-body">
        {LANGUAGE_VARIANTS.map((group) => (
          <div className="yy-variant-row" key={group.language}>
            <span>{group.language}</span>
            <SelectMenu
              quiet
              label={`${group.language} variant`}
              value={getLanguageVariant(group, variants)}
              options={group.options.map((value) => ({ value, label: value }))}
              onChange={(value) => onChange(setLanguageVariant(group, variants, value))}
            />
          </div>
        ))}
        <div className="yy-variant-help" onKeyDown={(event) => {
          if (event.key === 'Escape' && showHelp) {
            event.preventDefault();
            setShowHelp(false);
          }
        }}>
          <button type="button" aria-describedby={tipId} aria-expanded={showHelp} onClick={() => setShowHelp((shown) => !shown)}>
            What about other languages?
          </button>
          <div id={tipId} role="tooltip" data-visible={showHelp}>
            Variants are available for English, Chinese, Spanish, French, and Portuguese.
            Other languages use standard variants.
          </div>
        </div>
      </div>
    </LanguageDialog>
  );
}
