import { useMemo, useState, type ReactNode } from 'react';
import { BookText, Check, ChevronDown, History, PenLine, TextQuote } from 'lucide-react';
import type { OtherAppData } from '../../electron/otherApps';
import { defaultSelection, planImport, type ImportPlan, type ImportSelection, type ImportState } from '../services/otherAppImport';
import { STYLE_PRESETS } from '../services/personalization';
import type { ProviderId } from '../types/app';
import { SettingsSubdialog } from './SettingsSubdialog';
import { Toggle } from './Toggle';

export interface ImportResult {
  words: number;
  heardAs: number;
  snippets: number;
  history: number;
  settings: number;
}

type Section = 'words' | 'snippets' | 'settings' | 'history';

const styleLabel = (id: string) => STYLE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
const placeLabel = (category: string) => category === 'default' ? 'Everywhere else' : category;
const cleanupLabel = { none: 'None', light: 'Light', medium: 'Medium' } as const;
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** "5 snippets" when all are chosen, "3 of 5 snippets" when some are. */
const some = (chosen: number, total: number, one: string) => chosen === total || chosen === 0 ? count(total, one) : `${chosen} of ${count(total, one)}`;
const list = (parts: (string | false | 0 | undefined)[]) => new Intl.ListFormat('en').format(parts.filter(Boolean) as string[]);

/** What each mode of History is called, for the summary line. */
function historySummary(plan: ImportPlan): string {
  const modes = { dictate: 0, translate: 0, ask: 0 };
  for (const item of plan.history) modes[item.mode] += 1;
  return list([
    modes.dictate && count(modes.dictate, 'dictation'),
    modes.translate && count(modes.translate, 'translation'),
    modes.ask && count(modes.ask, 'Ask answer'),
  ]);
}

/** Settings changes the import can make, one key each, in the order shown. */
function settingKeys(plan: ImportPlan): string[] {
  return [
    ...plan.styles.filter((item) => item.status !== 'same').map((item) => `style:${item.category}`),
    ...(plan.cleanup && !plan.cleanup.same ? ['cleanup'] : []),
    ...(plan.stopLearningFromEdits ? ['learning'] : []),
  ];
}

function selectedSettings(selection: ImportSelection): string[] {
  return [
    ...selection.styles.map((category) => `style:${category}`),
    ...(selection.cleanup ? ['cleanup'] : []),
    ...(selection.stopLearningFromEdits ? ['learning'] : []),
  ];
}

function withSettings(selection: ImportSelection, keys: string[]): ImportSelection {
  return {
    ...selection,
    styles: keys.filter((key) => key.startsWith('style:')).map((key) => key.slice(6)),
    cleanup: keys.includes('cleanup'),
    stopLearningFromEdits: keys.includes('learning'),
  };
}

function ItemRow({ checked, disabled, onChange, title, detail }: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <label className="yy-import-item" data-disabled={disabled || undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span>
        <span className="yy-import-item-title">{title}</span>
        {detail && <span className="yy-import-item-detail">{detail}</span>}
      </span>
    </label>
  );
}

/**
 * Brings words, snippets, styles, and History over from another dictation app on this computer.
 * Each kind of data is one switch with a summary; its items open for review. Nothing the user
 * already set changes unless they choose it.
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
  const [open, setOpen] = useState<Section>();
  const [result, setResult] = useState<{ app: string; added: ImportResult }>();

  if (!plan) {
    return (
      <SettingsSubdialog title="Bring your setup over" description="Yap Yap can import from Wispr Flow and Typeless on this computer." onClose={onClose}>
        <div className="yy-language-body">
          <p className="yy-import-empty">Neither app is on this computer. Add your words in Dictionary, or import them as a CSV there.</p>
        </div>
      </SettingsSubdialog>
    );
  }

  const selection = selections[plan.app] ?? defaultSelection(plan);
  const update = (next: ImportSelection) => setSelections((current) => ({ ...current, [plan.app]: next }));
  const flip = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const newWords = plan.words.filter((item) => item.status !== 'exists').map((item) => item.key);
  const newSnippets = plan.snippets.filter((item) => item.status === 'new').map((item) => item.key);
  const settings = settingKeys(plan);
  const chosenSettings = selectedSettings(selection);
  const firstSelection = defaultSelection(plan);
  const done = result?.app === plan.app ? result.added : undefined;

  const footer = list([
    selection.words.length && count(selection.words.length, 'word'),
    selection.snippets.length && count(selection.snippets.length, 'snippet'),
    chosenSettings.length && count(chosenSettings.length, 'setting'),
    selection.history && plan.history.length && count(plan.history.length, 'History entry', 'History entries'),
  ]);

  const sections: {
    id: Section;
    icon: ReactNode;
    title: string;
    summary: string;
    /** Turned on, with how many of how many. Undefined: nothing to import here. */
    on?: { checked: boolean; set: (on: boolean) => void };
    items?: ReactNode;
  }[] = [];

  if (plan.words.length || plan.app === 'typeless') {
    sections.push({
      id: 'words',
      icon: <BookText size={16} />,
      title: 'Dictionary',
      summary: !plan.words.length
        ? plan.notes.find((note) => /dictionary/i.test(note)) ?? 'No words found.'
        : newWords.length
          ? `${some(selection.words.length, newWords.length, 'new word')}${plan.words.length > newWords.length ? `. ${plan.words.length - newWords.length} already saved` : ''}.`
          : 'Everything is already in your dictionary.',
      on: newWords.length ? { checked: selection.words.length > 0, set: (on) => update({ ...selection, words: on ? firstSelection.words : [] }) } : undefined,
      items: plan.words.length > 0 && plan.words.map((item) => (
        <ItemRow
          key={item.key}
          checked={item.status !== 'exists' && selection.words.includes(item.key)}
          disabled={item.status === 'exists'}
          onChange={() => update({ ...selection, words: flip(selection.words, item.key) })}
          title={item.word}
          detail={item.status === 'exists' ? 'Already saved'
            : item.heardAs ? `Fixes “${item.heardAs}”`
              : item.manual ? 'Added by you' : `Learned by ${plan.name}`}
        />
      )),
    });
  }

  if (plan.snippets.length) {
    sections.push({
      id: 'snippets',
      icon: <TextQuote size={16} />,
      title: 'Snippets',
      summary: newSnippets.length
        ? `${some(selection.snippets.length, newSnippets.length, 'snippet')}. Bold and links come over as plain text.`
        : 'You already have snippets with these phrases.',
      on: newSnippets.length ? { checked: selection.snippets.length > 0, set: (on) => update({ ...selection, snippets: on ? firstSelection.snippets : [] }) } : undefined,
      items: plan.snippets.map((item) => (
        <ItemRow
          key={item.key}
          checked={item.status === 'new' && selection.snippets.includes(item.key)}
          disabled={item.status !== 'new'}
          onChange={() => update({ ...selection, snippets: flip(selection.snippets, item.key) })}
          title={`“${item.trigger}”`}
          detail={item.status === 'exists' ? 'You have a snippet with this phrase'
            : item.status === 'invalid' ? 'Needs a phrase with a letter or number'
              : item.expansion.replace(/\s+/gu, ' ')}
        />
      )),
    });
  }

  if (plan.styles.length || plan.cleanup || plan.stopLearningFromEdits) {
    const pickedStyles = plan.styles.filter((item) => item.status !== 'same');
    sections.push({
      id: 'settings',
      icon: <PenLine size={16} />,
      title: 'Writing style and cleanup',
      summary: settings.length
        ? list([
            ...pickedStyles.map((item) => `${item.category === 'default' ? 'everywhere else' : item.category} ${styleLabel(item.style).toLowerCase()}`),
            plan.cleanup && !plan.cleanup.same && `${cleanupLabel[plan.cleanup.level].toLowerCase()} cleanup`,
          ]).replace(/^./u, (letter) => letter.toUpperCase())
        : 'Already set the same way.',
      on: settings.length ? { checked: chosenSettings.length > 0, set: (on) => update(withSettings(selection, on ? selectedSettings(firstSelection) : [])) } : undefined,
      items: (
        <>
          {plan.styles.map((item) => (
            <ItemRow
              key={item.category}
              checked={selection.styles.includes(item.category)}
              disabled={item.status === 'same'}
              onChange={() => update({ ...selection, styles: flip(selection.styles, item.category) })}
              title={`${placeLabel(item.category)}: ${styleLabel(item.style)}`}
              detail={item.status === 'same' ? 'Already set'
                : item.status === 'different' ? 'Replaces the style you picked in Yap Yap'
                  : item.category === 'default' ? 'Where you haven’t picked a style' : 'Applies from your next dictation'}
            />
          ))}
          {plan.cleanup && (
            <ItemRow
              checked={!plan.cleanup.same && selection.cleanup}
              disabled={plan.cleanup.same}
              onChange={() => update({ ...selection, cleanup: !selection.cleanup })}
              title={`AI cleanup: ${cleanupLabel[plan.cleanup.level]}`}
              detail={plan.cleanup.same ? 'Already set' : plan.cleanup.level === 'none' ? 'Pastes exactly what you said' : 'How much cleanup edits your words'}
            />
          )}
          {plan.stopLearningFromEdits && (
            <ItemRow
              checked={selection.stopLearningFromEdits}
              onChange={() => update({ ...selection, stopLearningFromEdits: !selection.stopLearningFromEdits })}
              title="Don’t learn from my edits"
              detail={`Off in ${plan.name} too`}
            />
          )}
        </>
      ),
    });
  }

  if (plan.history.length || plan.historyDuplicates) {
    sections.push({
      id: 'history',
      icon: <History size={16} />,
      title: 'History',
      summary: plan.history.length
        ? `${historySummary(plan)}. Text only. Counts in your stats, but doesn’t teach your style.`
        : 'Already imported.',
      on: plan.history.length ? { checked: selection.history, set: (on) => update({ ...selection, history: on }) } : undefined,
    });
  }

  if (done) {
    const lines = [
      done.words && count(done.words, 'word') + ' added to Dictionary',
      done.heardAs && count(done.heardAs, 'spelling fix', 'spelling fixes') + ' added to saved words',
      done.snippets && count(done.snippets, 'snippet') + ' ready to say',
      done.settings && count(done.settings, 'setting') + ' changed',
      done.history && count(done.history, 'entry', 'entries') + ' added to History',
    ].filter(Boolean) as string[];
    return (
      <SettingsSubdialog title={`Imported from ${plan.name}`} description="Everything below is in Yap Yap now. Undo removes all of it." onClose={onClose}>
        <div className="yy-language-body yy-import-done">
          <div className="yy-import-done-mark" aria-hidden="true"><Check size={22} strokeWidth={2.4} /></div>
          {lines.length
            ? <ul role="status">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
            : <p role="status">Nothing new to import.</p>}
          <div className="yy-import-actions">
            <button type="button" className="yy-pref-button" onClick={() => { onUndo(); setResult(undefined); }}>Undo</button>
            <button type="button" className="yy-pref-button" data-primary onClick={onClose}>Done</button>
          </div>
        </div>
      </SettingsSubdialog>
    );
  }

  return (
    <SettingsSubdialog
      wide
      title="Bring your setup over"
      description={`From ${plan.name} on this computer. Switch off anything you don’t want, or review it item by item. What you already set in Yap Yap stays.`}
      onClose={onClose}
    >
      <div className="yy-language-body yy-import-body">
        {apps.length > 1 && (
          <div className="yy-import-apps" role="tablist" aria-label="Import from">
            {apps.map((app) => (
              <button
                key={app.app}
                type="button"
                role="tab"
                aria-selected={app.app === plan.app}
                onClick={() => { setAppId(app.app); setOpen(undefined); }}
              >
                {app.name}
              </button>
            ))}
          </div>
        )}

        <ul className="yy-import-sections" aria-label={`What to import from ${plan.name}`}>
          {sections.map((section) => {
            const expanded = open === section.id && Boolean(section.items);
            return (
              <li key={section.id} data-off={!section.on?.checked || undefined}>
                <div className="yy-import-section">
                  <span className="yy-import-icon" aria-hidden="true">{section.icon}</span>
                  <span className="yy-import-text">
                    <span className="yy-import-title" id={`yy-import-${section.id}`}>{section.title}</span>
                    <span className="yy-import-summary">{section.summary}</span>
                    {section.items && (
                      <button
                        type="button"
                        className="yy-import-review"
                        aria-expanded={expanded}
                        aria-controls={`yy-import-items-${section.id}`}
                        onClick={() => setOpen(expanded ? undefined : section.id)}
                      >
                        {expanded ? 'Hide' : 'Review'}
                        <ChevronDown size={13} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                  {section.on && <Toggle label={`Import ${section.title.toLowerCase()}`} checked={section.on.checked} onChange={section.on.set} />}
                </div>
                {expanded && (
                  <div className="yy-import-items" id={`yy-import-items-${section.id}`} role="group" aria-labelledby={`yy-import-${section.id}`}>
                    {section.items}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {plan.notes.filter((note) => !/dictionary/i.test(note)).map((note) => <p key={note} className="yy-import-note">{note}</p>)}

        <div className="yy-import-actions">
          <span>{footer ? `Imports ${footer}.` : 'Nothing selected.'}</span>
          <button type="button" className="yy-pref-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="yy-pref-button"
            data-primary
            disabled={!footer}
            onClick={() => setResult({ app: plan.app, added: onImport(plan, selection) })}
          >
            Import
          </button>
        </div>
      </div>
    </SettingsSubdialog>
  );
}
