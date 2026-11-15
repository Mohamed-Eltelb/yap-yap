import { useState, type FormEvent } from 'react';
import { SettingsSubdialog } from './SettingsSubdialog';
import { SelectMenu } from './SelectMenu';
import {
  builtInCategory,
  DONT_LEARN,
  sourceKey,
  sourceLabel,
  WRITING_CATEGORIES,
  type DestinationEntry,
  type SourceChoice,
} from '../services/personalization';

const AUTOMATIC = 'auto';
type Option = SourceChoice | typeof AUTOMATIC;

/**
 * The apps and sites Yap Yap has seen, and the kind of place each one is. The user's choice
 * wins over the built-in rules and over what was learned, and can turn learning off for a place.
 */
export function SourceCategoriesDialog({ destinations, choices, onChange, onClose }: {
  destinations: DestinationEntry[];
  choices: Record<string, SourceChoice>;
  onChange: (choices: Record<string, SourceChoice>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  // Added here but not set yet. Kept only while the dialog is open.
  const [pending, setPending] = useState<string[]>([]);

  const rows: DestinationEntry[] = [
    ...pending
      .filter((key) => !destinations.some((entry) => entry.key === key))
      .map((key) => {
        const automatic = builtInCategory(key);
        return { key, automatic, builtIn: !!automatic, uses: 0 };
      }),
    ...destinations,
  ];

  const choose = (key: string, value: Option) => {
    const next = { ...choices };
    if (value === AUTOMATIC) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const key = sourceKey(draft);
    if (!key) return;
    if (rows.some((entry) => entry.key === key)) {
      setError(`${sourceLabel(key)} is already in the list.`);
      return;
    }
    setPending((keys) => [key, ...keys]);
    setDraft('');
    setError('');
  };

  return (
    <SettingsSubdialog
      wide
      title="Apps and sites"
      description="The kind of place each app or site is decides which learned style and rules Yap Yap uses there. Your choice wins over what Yap Yap picks automatically."
      onClose={onClose}
    >
      <div className="yy-language-body yy-variant-body yy-source-body">
        {rows.length === 0 && (
          <p className="yy-source-empty">No apps or sites yet. Dictate somewhere, or add one below.</p>
        )}
        {rows.map((entry) => {
          const automatic = entry.automatic ? `Automatic: ${entry.automatic}` : 'Automatic: not sure yet';
          const options: { value: Option; label: string }[] = [
            { value: AUTOMATIC, label: automatic },
            ...WRITING_CATEGORIES.map((category) => ({ value: category, label: category })),
            { value: DONT_LEARN, label: 'Don’t learn here' },
          ];
          const detail = entry.choice
            ? 'Set by you'
            : entry.builtIn
              ? 'Recognized automatically'
              : entry.automatic
                ? 'Learned from your dictation'
                : entry.uses > 0
                  ? 'Needs a few more dictations to tell'
                  : 'Pick a kind of place';
          return (
            <div className="yy-variant-row yy-source-row" key={entry.key}>
              <span className="yy-source-name">
                <span title={entry.key}>{sourceLabel(entry.key)}</span>
                <small>{detail}</small>
              </span>
              <SelectMenu
                quiet
                label={`Kind of place for ${sourceLabel(entry.key)}`}
                value={entry.choice ?? AUTOMATIC}
                options={options}
                onChange={(value) => choose(entry.key, value)}
              />
            </div>
          );
        })}
        <form className="yy-source-add" onSubmit={add}>
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
            placeholder="Add an app or site, like notion.so"
            aria-label="App or site to add"
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'yy-source-error' : undefined}
            maxLength={200}
          />
          <button type="submit" className="yy-pref-button" disabled={!sourceKey(draft)}>Add</button>
        </form>
        {error && <p id="yy-source-error" role="alert" className="yy-source-error">{error}</p>}
      </div>
    </SettingsSubdialog>
  );
}
