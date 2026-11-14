import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, LoaderCircle, Minus, Plus, X } from 'lucide-react';
import { proposeWritingPreferences } from '../services/providers/engine';
import { parseWritingPreferences, readWritingRule, type WritingProfile } from '../services/personalization';
import type { ProviderConfig } from '../types/app';
import { CategoryIcon } from './CategoryIcon';
import { SettingsSubdialog } from './SettingsSubdialog';

interface Props {
  /** Saved rules, one per line. */
  preferences: string;
  profiles: readonly WritingProfile[];
  /** The AI provider that turns a request into rules. Rules can still be removed without one. */
  provider?: ProviderConfig;
  /** Rules are applied by AI cleanup, so they do nothing while it is off. */
  cleanupEnabled: boolean;
  onSave: (preferences: string) => void;
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

export function PersonalizationEditor({
  preferences, profiles, provider, cleanupEnabled, onSave, onClose, onOpenProviders,
}: Props) {
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  // Increases with each request, so a reply to an older or abandoned request is ignored.
  const latestCall = useRef(0);
  const rules = useMemo(() => parseWritingPreferences(preferences), [preferences]);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [proposal, setProposal] = useState<string[]>();
  const [notice, setNotice] = useState<string>();
  /** What was saved before the last change, so it can be put back. */
  const [previous, setPrevious] = useState<string>();

  useEffect(() => {
    // The dialog focuses its close button when it opens. Typing a request is the main action.
    input.current?.focus();
    return () => { latestCall.current = -1; };
  }, []);

  const save = (next: readonly string[], message: string) => {
    setPrevious(preferences);
    setProposal(undefined);
    setError(undefined);
    setNotice(message);
    onSave(next.join('\n'));
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
      const unchanged = next.length === rules.length && next.every((rule) => current.has(ruleKey(rule)));
      if (unchanged) {
        setNotice('Your rules already cover that.');
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

  const proposed = proposal && new Set(proposal.map(ruleKey));
  const saved = new Set(rules.map(ruleKey));
  const rows = [
    ...rules.map((text) => ({ text, change: proposed && !proposed.has(ruleKey(text)) ? 'removed' as const : undefined })),
    ...(proposal ?? []).filter((text) => !saved.has(ruleKey(text))).map((text) => ({ text, change: 'added' as const })),
  ];

  return (
    <SettingsSubdialog
      wide
      title="Writing preferences"
      description="Rules Yap Yap follows when it cleans up your dictation. They come before the style it learns on its own."
      onClose={onClose}
    >
      <div className="yy-pref-editor">
        {!cleanupEnabled && (
          <p className="yy-pref-note">AI cleanup is off in Settings, so these rules are not applied right now.</p>
        )}

        {rows.length > 0 ? (
          <ul className="yy-pref-rules" data-review={proposal ? '' : undefined} aria-label={proposal ? 'Rules with the proposed change' : 'Saved rules'}>
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
                    onClick={() => save(rules.filter((rule) => rule !== text), 'Rule removed.')}
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="yy-pref-empty">
            No rules yet. Describe how you want your text written, and Yap Yap will turn it into a rule.
          </p>
        )}

        {proposal && (
          <div className="yy-pref-actions">
            <span>{proposal.length === 0 ? 'This removes all your rules.' : 'Review the change before saving.'}</span>
            <button type="button" className="yy-pref-button" onClick={() => { setProposal(undefined); input.current?.focus(); }}>
              Discard
            </button>
            <button type="button" className="yy-pref-button" data-primary onClick={() => save(proposal, 'Rules saved.')}>
              Save rules
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
            <label htmlFor={inputId} className="sr-only">Describe a change to your rules</label>
            <textarea
              ref={input}
              id={inputId}
              rows={2}
              maxLength={600}
              value={request}
              disabled={busy}
              placeholder={rules.length ? 'Describe a change, or a rule to remove' : 'Describe how you want your text written'}
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
            <p>Adding or changing rules needs an AI provider. You can still remove rules above.</p>
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

        {profiles.length > 0 && (
          <details className="yy-pref-learned">
            <summary>What Yap Yap has learned from your dictation</summary>
            <ul>
              {profiles.map((profile) => (
                <li key={profile.category}>
                  <CategoryIcon category={profile.category} />
                  <div>
                    <strong>{profile.category}</strong>
                    <span>{profile.tone} tone. {profile.phrasing}</span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </SettingsSubdialog>
  );
}
