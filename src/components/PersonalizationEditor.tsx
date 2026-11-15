import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, LoaderCircle, Minus, Plus, X } from 'lucide-react';
import { proposeWritingPreferences } from '../services/providers/engine';
import { parseWritingPreferences, readWritingRule, type WritingProfile } from '../services/personalization';
import type { ProviderConfig, StyleCorrections } from '../types/app';
import { CategoryIcon } from './CategoryIcon';
import { SettingsSubdialog } from './SettingsSubdialog';

interface Saved {
  writingPreferences: string;
  styleCorrections: StyleCorrections;
}

interface Props {
  /** Saved rules, one per line. */
  preferences: string;
  /** Learned styles with the user's corrections already applied. */
  profiles: readonly (WritingProfile & { corrected?: boolean })[];
  styleCorrections: StyleCorrections;
  /** The AI provider that turns a request into changes. Rules can still be removed without one. */
  provider?: ProviderConfig;
  /** Rules and styles are applied by AI cleanup, so they do nothing while it is off. */
  cleanupEnabled: boolean;
  onSave: (changes: Saved) => void;
  onClose: () => void;
  onOpenProviders: () => void;
}

const suggestions = [
  'No period at the end of chat messages',
  'Write numbers as digits',
  'Use British spelling',
];

/** Rules that differ only by case or a final period are the same rule. */
const ruleKey = (rule: string) => rule.toLowerCase().replace(/[.\s]+$/u, '');

const describeStyle = (style: { tone: string; phrasing: string }) => `${style.tone} tone. ${style.phrasing.replace(/[.\s]*$/u, '.')}`;

export function PersonalizationEditor({
  preferences, profiles, styleCorrections, provider, cleanupEnabled, onSave, onClose, onOpenProviders,
}: Props) {
  const inputId = useId();
  const rulesHeadingId = useId();
  const stylesHeadingId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  // Increases with each request, so a reply to an older or abandoned request is ignored.
  const latestCall = useRef(0);
  const rules = useMemo(() => parseWritingPreferences(preferences), [preferences]);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [proposal, setProposal] = useState<{ rules: string[]; styles: StyleCorrections }>();
  const [notice, setNotice] = useState<string>();
  /** What was saved before the last change, so it can be put back. */
  const [previous, setPrevious] = useState<Saved>();

  useEffect(() => {
    // The dialog focuses its close button when it opens. Typing a request is the main action.
    input.current?.focus();
    return () => { latestCall.current = -1; };
  }, []);

  const save = (next: Partial<Saved>, message: string) => {
    setPrevious({ writingPreferences: preferences, styleCorrections });
    setProposal(undefined);
    setError(undefined);
    setNotice(message);
    onSave({ writingPreferences: preferences, styleCorrections, ...next });
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const instruction = request.trim();
    if (!provider || !instruction || busy) return;
    const call = ++latestCall.current;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setPrevious(undefined);
    setProposal(undefined);
    try {
      const next = await proposeWritingPreferences(provider, { rules, profiles }, instruction);
      if (call !== latestCall.current) return;
      const current = new Set(rules.map(ruleKey));
      const rulesUnchanged = next.rules.length === rules.length && next.rules.every((rule) => current.has(ruleKey(rule)));
      if (rulesUnchanged && Object.keys(next.styles).length === 0) {
        setNotice('Nothing to change for that. Your rules and learned style already match it.');
      } else {
        setProposal(next);
        setRequest('');
      }
    } catch (failure) {
      if (call !== latestCall.current) return;
      setError(failure instanceof Error ? failure.message : 'The update could not be prepared. Try again.');
    } finally {
      if (call === latestCall.current) setBusy(false);
    }
  };

  const proposed = proposal && new Set(proposal.rules.map(ruleKey));
  const saved = new Set(rules.map(ruleKey));
  const rows = [
    ...rules.map((text) => ({ text, change: proposed && !proposed.has(ruleKey(text)) ? 'removed' as const : undefined })),
    ...(proposal?.rules ?? []).filter((text) => !saved.has(ruleKey(text))).map((text) => ({ text, change: 'added' as const })),
  ];
  const rulesChanged = rows.some((row) => row.change);
  const stylesChanged = Object.keys(proposal?.styles ?? {}).length > 0;

  return (
    <SettingsSubdialog
      wide
      title="Writing preferences"
      description="How Yap Yap writes for you when it cleans up your dictation. Ask for a change in your own words."
      onClose={onClose}
    >
      <div className="yy-pref-editor">
        {!cleanupEnabled && (
          <p className="yy-pref-note">AI cleanup is off in Settings, so your rules and learned style are not applied right now.</p>
        )}

        <section className="yy-pref-section" aria-labelledby={rulesHeadingId}>
          <div className="yy-pref-heading">
            <h3 id={rulesHeadingId}>Your rules</h3>
            <p>Yap Yap always follows these.</p>
          </div>
          {rows.length > 0 ? (
            <ul className="yy-pref-rules" data-review={rulesChanged ? '' : undefined} aria-labelledby={rulesHeadingId}>
              {rows.map(({ text, change }) => (
                <li key={`${change ?? 'saved'}-${text}`} data-change={change}>
                  {change === 'added' && <Plus aria-hidden="true" size={14} className="yy-pref-mark" />}
                  {change === 'removed' && <Minus aria-hidden="true" size={14} className="yy-pref-mark" />}
                  <span>
                    {change && <span className="sr-only">{change === 'added' ? 'New rule: ' : 'Removed rule: '}</span>}
                    {readWritingRule(text).text}
                    {readWritingRule(text).category && (
                      <em className="yy-pref-scope">
                        <span className="sr-only">Applies in </span>
                        {readWritingRule(text).category}
                      </em>
                    )}
                  </span>
                  {!proposal && (
                    <button
                      type="button"
                      aria-label={`Remove rule: ${readWritingRule(text).text}`}
                      onClick={() => save({ writingPreferences: rules.filter((rule) => rule !== text).join('\n') }, 'Rule removed.')}
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="yy-pref-empty">No rules yet, such as “Write numbers as digits”.</p>
          )}
        </section>

        <section className="yy-pref-section" aria-labelledby={stylesHeadingId}>
          <div className="yy-pref-heading">
            <h3 id={stylesHeadingId}>Learned style</h3>
            <p>Picked up from your dictation and kept up to date. Your corrections replace it until you reset them.</p>
          </div>
          {profiles.length > 0 ? (
            <ul className="yy-pref-rules yy-pref-styles" data-review={stylesChanged ? '' : undefined} aria-labelledby={stylesHeadingId}>
              {profiles.flatMap((profile) => {
                const next = proposal?.styles[profile.category];
                if (next) {
                  return [
                    <li key={`removed-${profile.category}`} data-change="removed">
                      <Minus aria-hidden="true" size={14} className="yy-pref-mark" />
                      <CategoryIcon category={profile.category} />
                      <div>
                        <strong>{profile.category}</strong>
                        <span><span className="sr-only">Style now: </span>{describeStyle(profile)}</span>
                      </div>
                    </li>,
                    <li key={`added-${profile.category}`} data-change="added">
                      <Plus aria-hidden="true" size={14} className="yy-pref-mark" />
                      <CategoryIcon category={profile.category} />
                      <div>
                        <strong>{profile.category}</strong>
                        <span><span className="sr-only">Corrected style: </span>{describeStyle(next)}</span>
                      </div>
                    </li>,
                  ];
                }
                return [
                  <li key={profile.category}>
                    <CategoryIcon category={profile.category} />
                    <div>
                      <strong>
                        {profile.category}
                        {profile.corrected && <em className="yy-pref-scope">Corrected by you</em>}
                      </strong>
                      <span>{describeStyle(profile)}</span>
                    </div>
                    {profile.corrected && !proposal && (
                      <button
                        type="button"
                        className="yy-pref-reset"
                        aria-label={`Go back to the learned ${profile.category} style`}
                        onClick={() => {
                          const rest = { ...styleCorrections };
                          delete rest[profile.category];
                          save({ styleCorrections: rest }, `${profile.category} is back to the learned style.`);
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </li>,
                ];
              })}
            </ul>
          ) : (
            <p className="yy-pref-empty">Nothing learned yet. Keep dictating and Yap Yap will pick up how you write in each app.</p>
          )}
        </section>

        {proposal && (
          <div className="yy-pref-actions">
            <span>
              {rulesChanged && proposal.rules.length === 0 ? 'This removes all your rules.' : 'Review the change before saving.'}
            </span>
            <button type="button" className="yy-pref-button" onClick={() => { setProposal(undefined); input.current?.focus(); }}>
              Discard
            </button>
            <button
              type="button"
              className="yy-pref-button"
              data-primary
              onClick={() => save({
                writingPreferences: proposal.rules.join('\n'),
                styleCorrections: { ...styleCorrections, ...proposal.styles },
              }, 'Changes saved.')}
            >
              Save
            </button>
          </div>
        )}

        <div role="status" className="yy-pref-status">
          {notice && (
            <>
              {notice}
              {previous !== undefined && (
                <button
                  type="button"
                  onClick={() => {
                    onSave(previous);
                    setPrevious(undefined);
                    setNotice('Change undone.');
                  }}
                >
                  Undo
                </button>
              )}
            </>
          )}
        </div>

        {provider ? (
          <form className="yy-pref-composer" onSubmit={(event) => void submit(event)}>
            <label htmlFor={inputId} className="sr-only">Add a rule or tell Yap Yap what it got wrong</label>
            <textarea
              ref={input}
              id={inputId}
              rows={2}
              maxLength={600}
              value={request}
              disabled={busy}
              placeholder="Add a rule or tell Yap Yap what it got wrong"
              onChange={(event) => {
                setRequest(event.target.value);
                setError(undefined);
              }}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter adds a line. Leave Enter alone while an IME is composing.
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void submit();
              }}
            />
            <button type="submit" aria-label="Preview change" disabled={!request.trim() || busy}>
              {busy
                ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin" />
                : <ArrowUp aria-hidden="true" size={16} />}
            </button>
          </form>
        ) : (
          <div className="yy-pref-note">
            <p>Adding rules or correcting the learned style needs an AI provider. You can still remove rules and reset corrections here.</p>
            <button type="button" className="yy-pref-button" data-primary onClick={onOpenProviders}>Set up a provider</button>
          </div>
        )}

        {error && <p role="alert" className="yy-pref-error">{error}</p>}

        {provider && !request && !proposal && !busy && (
          <div className="yy-pref-suggestions">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => {
                  setRequest(text);
                  setError(undefined);
                  input.current?.focus();
                }}
              >
                {text}
              </button>
            ))}
          </div>
        )}
      </div>
    </SettingsSubdialog>
  );
}
