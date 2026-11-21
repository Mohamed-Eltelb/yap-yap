import { useMemo, useState } from 'react';
import type { OtherAppData } from '../../electron/otherApps';
import { defaultSelection, planImport, type ImportPlan, type ImportSelection, type ImportState } from '../services/otherAppImport';
import { STYLE_PRESETS } from '../services/personalization';
import type { ProviderId } from '../types/app';
import { SettingsSubdialog } from './SettingsSubdialog';

export interface ImportResult {
  words: number;
  heardAs: number;
  snippets: number;
  history: number;
  settings: number;
}

const styleLabel = (id: string) => STYLE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
const placeLabel = (category: string) => category === 'default' ? 'Everywhere else' : category;
const cleanupLabel = { none: 'None', light: 'Light', medium: 'Medium' } as const;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function describe(result: ImportResult): string {
  const parts = [
    result.words && plural(result.words, 'word'),
    result.heardAs && plural(result.heardAs, 'spelling fix', 'spelling fixes'),
    result.snippets && plural(result.snippets, 'snippet'),
    result.history && plural(result.history, 'History entry', 'History entries'),
    result.settings && plural(result.settings, 'setting'),
  ].filter(Boolean);
  return parts.length ? `Imported ${new Intl.ListFormat('en').format(parts as string[])}.` : 'Nothing new to import.';
}

/**
 * Brings words, snippets, styles, and History over from another dictation app on this computer.
 * Everything is shown for review first; nothing the user already set is changed unless they tick it.
 */
export function ImportDialog({ apps, state, defaultProvider, onImport, onUndo, onClose }: {
  apps: OtherAppData[];
  state: ImportState;
  defaultProvider: ProviderId;
  onImport: (plan: ImportPlan, selection: ImportSelection) => ImportResult;
  onUndo: () => void;
  onClose: () => void;
}) {
  const [appId, setAppId] = useState(apps[0]?.app);
  const data = apps.find((app) => app.app === appId) ?? apps[0];
  // Planned once per app, against what Yap Yap had when the dialog opened, so the review stays put.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => data && planImport(data, state, defaultProvider), [data]);
  const [selections, setSelections] = useState<Record<string, ImportSelection>>({});
  const selection = plan && (selections[plan.app] ?? defaultSelection(plan));
  const [result, setResult] = useState<{ app: string; text: string }>();

  if (!plan || !selection) {
    return (
      <SettingsSubdialog title="Import from another app" description="Bring your words, snippets, and styles from Wispr Flow or Typeless." onClose={onClose}>
        <div className="yy-language-body yy-import-body">
          <p className="yy-source-empty">Yap Yap didn’t find Wispr Flow or Typeless on this computer.</p>
        </div>
      </SettingsSubdialog>
    );
  }

  const update = (patch: Partial<ImportSelection>) => setSelections((current) => ({ ...current, [plan.app]: { ...selection, ...patch } }));
  const toggle = (key: 'words' | 'snippets' | 'styles', item: string) => update({
    [key]: selection[key].includes(item) ? selection[key].filter((value) => value !== item) : [...selection[key], item],
  });
  const toggleAll = (key: 'words' | 'snippets' | 'styles', items: string[]) => update({
    [key]: items.every((item) => selection[key].includes(item)) ? selection[key].filter((value) => !items.includes(value)) : [...new Set([...selection[key], ...items])],
  });

  const newWords = plan.words.filter((item) => item.status !== 'exists');
  const newSnippets = plan.snippets.filter((item) => item.status === 'new');
  const chosen = selection.words.length + selection.snippets.length + selection.styles.length
    + Number(selection.history) + Number(selection.cleanup) + Number(selection.stopLearningFromEdits);
  const done = result?.app === plan.app;

  const groupBox = (key: 'words' | 'snippets' | 'styles', items: string[], label: string) => items.length > 1 && (
    <input
      type="checkbox"
      aria-label={label}
      checked={items.every((item) => selection[key].includes(item))}
      ref={(element) => {
        if (element) element.indeterminate = items.some((item) => selection[key].includes(item)) && !items.every((item) => selection[key].includes(item));
      }}
      onChange={() => toggleAll(key, items)}
      disabled={done}
    />
  );

  return (
    <SettingsSubdialog
      wide
      title={`Import from ${plan.name}`}
      description={`Found ${plan.name} on this computer. Pick what to bring over. Nothing you already set in Yap Yap changes unless you tick it.`}
      onClose={onClose}
    >
      <div className="yy-language-body yy-import-body">
        {apps.length > 1 && (
          <div className="yy-import-apps" role="tablist" aria-label="App to import from">
            {apps.map((app) => (
              <button key={app.app} type="button" role="tab" aria-selected={app.app === plan.app} onClick={() => setAppId(app.app)}>
                {app.name}
              </button>
            ))}
          </div>
        )}

        {plan.words.length > 0 && (
          <section className="yy-style-section" aria-labelledby="yy-import-words">
            <div className="yy-import-heading">
              {groupBox('words', newWords.map((item) => item.key), 'All dictionary words')}
              <h3 id="yy-import-words">Dictionary</h3>
            </div>
            <p>Names and terms, and spellings {plan.name} fixed for you, such as “{plan.words.find((item) => item.heardAs)?.heardAs ?? 'hand of'}”.</p>
            {plan.words.map((item) => (
              <label className="yy-spoken-row yy-import-row" key={item.key} data-muted={item.status === 'exists' || undefined}>
                <input type="checkbox" disabled={item.status === 'exists' || done} checked={selection.words.includes(item.key)} onChange={() => toggle('words', item.key)} />
                <span className="yy-source-name">
                  <span>{item.word}</span>
                  <small>
                    {item.status === 'exists' ? 'Already in your dictionary'
                      : item.heardAs ? `Replaces “${item.heardAs}”${item.status === 'adds-heard-as' ? ' (word already saved)' : ''}`
                        : item.manual ? 'Added by you' : `Learned by ${plan.name}`}
                  </small>
                </span>
              </label>
            ))}
          </section>
        )}

        {plan.snippets.length > 0 && (
          <section className="yy-style-section" aria-labelledby="yy-import-snippets">
            <div className="yy-import-heading">
              {groupBox('snippets', newSnippets.map((item) => item.key), 'All snippets')}
              <h3 id="yy-import-snippets">Snippets</h3>
            </div>
            <p>Say the phrase to insert the saved text. Formatting such as bold or links comes over as plain text.</p>
            {plan.snippets.map((item) => (
              <label className="yy-spoken-row yy-import-row" key={item.key} data-muted={item.status !== 'new' || undefined}>
                <input type="checkbox" disabled={item.status !== 'new' || done} checked={selection.snippets.includes(item.key)} onChange={() => toggle('snippets', item.key)} />
                <span className="yy-source-name">
                  <span>“{item.trigger}”</span>
                  <small>
                    {item.status === 'exists' ? 'A snippet with this phrase already exists'
                      : item.status === 'invalid' ? 'Can’t be used: the phrase needs a letter or number and some text to insert'
                        : item.expansion.replace(/\s+/gu, ' ').slice(0, 90) + (item.expansion.length > 90 ? '…' : '')}
                  </small>
                </span>
              </label>
            ))}
          </section>
        )}

        {(plan.styles.length > 0 || plan.cleanup || plan.stopLearningFromEdits) && (
          <section className="yy-style-section" aria-labelledby="yy-import-settings">
            <div className="yy-import-heading">
              <h3 id="yy-import-settings">Settings</h3>
            </div>
            <p>The style you picked in {plan.name} for each kind of place applies from your next dictation.</p>
            {plan.styles.map((item) => {
              const current = item.category === 'default' ? state.settings.defaultStyle : undefined;
              return (
                <label className="yy-spoken-row yy-import-row" key={item.category} data-muted={item.status === 'same' || undefined}>
                  <input type="checkbox" disabled={item.status === 'same' || done} checked={item.status !== 'same' && selection.styles.includes(item.category)} onChange={() => toggle('styles', item.category)} />
                  <span className="yy-source-name">
                    <span>{placeLabel(item.category)}: {styleLabel(item.style)}</span>
                    <small>
                      {item.status === 'same' ? 'Already set'
                        : item.status === 'different' ? `Replaces the ${current ? `${styleLabel(current)} ` : ''}style you picked in Yap Yap`
                          : item.category === 'default' ? 'Where you haven’t picked a style' : 'Replaces what Yap Yap learned here'}
                    </small>
                  </span>
                </label>
              );
            })}
            {plan.cleanup && (
              <label className="yy-spoken-row yy-import-row" data-muted={plan.cleanup.same || undefined}>
                <input type="checkbox" disabled={plan.cleanup.same || done} checked={!plan.cleanup.same && selection.cleanup} onChange={() => update({ cleanup: !selection.cleanup })} />
                <span className="yy-source-name">
                  <span>AI cleanup: {cleanupLabel[plan.cleanup.level]}</span>
                  <small>{plan.cleanup.same ? 'Already set' : plan.cleanup.level === 'none' ? 'Pastes exactly what you said' : 'How much cleanup edits your dictation'}</small>
                </span>
              </label>
            )}
            {plan.stopLearningFromEdits && (
              <label className="yy-spoken-row yy-import-row">
                <input type="checkbox" disabled={done} checked={selection.stopLearningFromEdits} onChange={() => update({ stopLearningFromEdits: !selection.stopLearningFromEdits })} />
                <span className="yy-source-name">
                  <span>Don’t learn from my edits</span>
                  <small>{plan.name} has learning words from your edits turned off</small>
                </span>
              </label>
            )}
          </section>
        )}

        {(plan.history.length > 0 || plan.historyDuplicates > 0) && (
          <section className="yy-style-section" aria-labelledby="yy-import-history">
            <label className="yy-spoken-row yy-import-row" data-muted={!plan.history.length || undefined}>
              <input type="checkbox" disabled={!plan.history.length || done} checked={selection.history} onChange={() => update({ history: !selection.history })} />
              <span className="yy-source-name">
                <span id="yy-import-history">History: {plural(plan.history.length, 'entry', 'entries')}</span>
                <small>
                  {plan.history.length
                    ? `Text only, no recordings. Counts toward your stats and apps, but doesn’t teach your style.${plan.historyDuplicates ? ` ${plural(plan.historyDuplicates, 'entry', 'entries')} already imported.` : ''}`
                    : 'Already imported.'}
                </small>
              </span>
            </label>
          </section>
        )}

        {plan.notes.map((note) => <p key={note} className="yy-pref-note">{note}</p>)}

        <div className="yy-import-actions">
          <span role="status">{done ? result.text : ''}</span>
          {done ? (
            <>
              <button type="button" className="yy-pref-button" onClick={() => { onUndo(); setResult(undefined); }}>Undo</button>
              <button type="button" className="yy-pref-button" data-primary onClick={onClose}>Done</button>
            </>
          ) : (
            <>
              <button type="button" className="yy-pref-button" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="yy-pref-button"
                data-primary
                disabled={chosen === 0}
                onClick={() => setResult({ app: plan.app, text: describe(onImport(plan, selection)) })}
              >
                Import
              </button>
            </>
          )}
        </div>
      </div>
    </SettingsSubdialog>
  );
}
