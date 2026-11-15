import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, LoaderCircle, Minus, Plus, X } from 'lucide-react';
import { proposeWritingPreferences, suggestStyleUpdate } from '../services/providers/engine';
import { mergeStyleCorrections, parseWritingPreferences, rejectStyles, STYLE_UPDATE_MIN_SAMPLES, type StyleSampleSinceCorrection, readWritingRule, type ForgottenStyles, type WritingProfile } from '../services/personalization';
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
  /** A category to bring into view when the editor opens. */
  focusCategory?: string;
  /** Styles learned since each correction, newest first. */
  recentSamples?: Record<string, StyleSampleSinceCorrection[]>;
  /** Forgets what was learned for a category and returns what Undo puts back. */
  onForgetStyle: (category: string) => ForgottenStyles;
  onRestoreStyle: (forgotten: ForgottenStyles) => void;
  onClose: () => void;
  onOpenProviders: () => void;
}

/** Short labels keep the chips on one line. A click fills in the full request. */
const suggestions = [
  { label: 'No period in chats', request: 'No period at the end of chat messages' },
  { label: 'Numbers as digits', request: 'Write numbers as digits' },
  { label: 'British spelling', request: 'Use British spelling' },
];

/** Suggestion checks already made this session, so reopening the editor does not ask again. */
const checkedUpdates = new Map<string, Promise<StyleCorrections[string] | undefined>>();

const listCategories =(names: readonly string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(names);

/** Rules that differ only by case or a final period are the same rule. */
const ruleKey = (rule: string) => rule.toLowerCase().replace(/[.\s]+$/u, '');

const describeStyle = (style: { tone: string; phrasing: string }) =>
  `${style.tone} tone.${style.phrasing ? ` ${style.phrasing.replace(/[.\s]*$/u, '.')}` : ''}`;

export function PersonalizationEditor({
  preferences, profiles, styleCorrections, provider, cleanupEnabled, focusCategory, recentSamples, onSave, onForgetStyle, onRestoreStyle, onClose, onOpenProviders,
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
  /** Puts back the last change. */
  const [undo, setUndo] = useState<() => void>();

  useEffect(() => {
    // The dialog focuses its close button when it opens. Typing a request is the main action.
    // Opened for a category, the focus must not scroll the dialog away from it.
    input.current?.focus({ preventScroll: Boolean(focusCategory) });
    return () => { latestCall.current = -1; };
    // Runs once when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened from a category in the report: bring that style into view and mark it briefly.
  const [focused, setFocused] = useState(focusCategory);

  // Corrections the user's recent writing no longer matches. Checked once when the editor opens.
  // Each suggestion remembers the correction it was made for, and disappears if that changes.
  const [updates, setUpdates] = useState<Record<string, { tone?: string; phrasing?: string; since?: string }>>({});
  useEffect(() => {
    if (!provider || !recentSamples) return;
    let open = true;
    void (async () => {
      for (const [category, samples] of Object.entries(recentSamples)) {
        const correction = styleCorrections[category];
        if (!correction) continue;
        // Asks again only after 5 more dictations, or for another provider or correction.
        const key = [
          category, correction.since, Math.floor(samples.length / STYLE_UPDATE_MIN_SAMPLES),
          JSON.stringify(correction.rejected ?? {}), provider.id, provider.llmModel,
        ].join('|');
        if (!checkedUpdates.has(key)) checkedUpdates.set(key, suggestStyleUpdate(provider, correction, samples));
        const update = await checkedUpdates.get(key);
        if (open && update) setUpdates((current) => ({ ...current, [category]: { ...update, since: correction.since } }));
      }
    })();
    return () => { open = false; };
    // Runs once when the editor opens; a decision below updates the saved correction itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const updateFor = (category: string) => {
    const update = updates[category];
    return update && styleCorrections[category]?.since === update.since ? update : undefined;
  };

  /** Update takes the suggestion; Keep mine remembers it as turned down. Both wait for new dictations. */
  const decideUpdate = (category: string, accept: boolean) => {
    const update = updateFor(category);
    if (!update) return;
    const { since: _since, ...fields } = update;
    setUpdates(({ [category]: _done, ...rest }) => rest);
    const change = accept ? fields : rejectStyles(styleCorrections[category], fields);
    save(
      { styleCorrections: mergeStyleCorrections(styleCorrections, { [category]: change }, new Date().toISOString()) },
      accept ? `${category} style updated.` : `Kept your ${category} correction.`,
    );
  };
  useEffect(() => {
    if (!focusCategory) return;
    const row = [...document.querySelectorAll<HTMLElement>('.yy-pref-styles li[data-category]')]
      .find((element) => element.dataset.category === focusCategory);
    row?.scrollIntoView({ block: 'center' });
    const timer = window.setTimeout(() => setFocused(undefined), 1600);
    return () => window.clearTimeout(timer);
  }, [focusCategory]);

  /** Puts focus back on the request box after an action removes the button that had it. */
  const refocus = () => window.setTimeout(() => input.current?.focus({ preventScroll: true }), 0);

  const save = (next: Partial<Saved>, message: string) => {
    const before = { writingPreferences: preferences, styleCorrections };
    setUndo(() => () => onSave(before));
    setProposal(undefined);
    setError(undefined);
    setNotice(message);
    onSave({ writingPreferences: preferences, styleCorrections, ...next });
    refocus();
  };

  /**
   * Saves the reviewed change. Each corrected style also remembers what it replaced, so the
   * habit the user corrected is never suggested back to them. Styles for a category that is no
   * longer learned are dropped, since they would apply unseen once it is learned again.
   */
  const saveProposal = (change: { rules: string[]; styles: StyleCorrections }) => {
    const styles: StyleCorrections = {};
    for (const [category, correction] of Object.entries(change.styles)) {
      const profile = profiles.find((item) => item.category === category);
      if (!profile) continue;
      styles[category] = {
        ...rejectStyles(styleCorrections[category], {
          tone: correction.tone && profile.tone,
          phrasing: correction.phrasing && profile.phrasing,
        }),
        ...correction,
      };
    }
    // Save exactly what the review showed: saved rules keep their text and order, minus the
    // removed ones, and new rules follow. The AI may also reorder or recase rules; that is not saved.
    const proposedKeys = new Set(change.rules.map(ruleKey));
    const savedKeys = new Set(rules.map(ruleKey));
    const nextRules = [
      ...rules.filter((rule) => proposedKeys.has(ruleKey(rule))),
      ...change.rules.filter((rule) => !savedKeys.has(ruleKey(rule))),
    ];
    save({
      writingPreferences: nextRules.join('\n'),
      styleCorrections: mergeStyleCorrections(styleCorrections, styles, new Date().toISOString()),
    }, 'Changes saved.');
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const instruction = request.trim();
    if (!provider || !instruction || busy) return;
    const call = ++latestCall.current;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setUndo(undefined);
    setProposal(undefined);
    try {
      const next = await proposeWritingPreferences(provider, { rules, profiles }, instruction);
      if (call !== latestCall.current) return;
      const current = new Set(rules.map(ruleKey));
      const rulesUnchanged = next.rules.length === rules.length && next.rules.every((rule) => current.has(ruleKey(rule)));
      // Part of a request can be about a place with nothing learned yet, even when the rest changes something.
      const unlearnedNote = next.unlearned.length
        ? `Yap Yap hasn’t learned a style for ${listCategories(next.unlearned)} yet. It will after you dictate there a few times, and then you can correct it here.`
        : undefined;
      if (rulesUnchanged && Object.keys(next.styles).length === 0) {
        setNotice(unlearnedNote ?? 'Nothing to change for that. Your rules and learned style already match it.');
      } else {
        setProposal(next);
        setNotice(unlearnedNote);
        setRequest('');
      }
    } catch (failure) {
      if (call !== latestCall.current) return;
      setError(failure instanceof Error ? failure.message : 'The update could not be prepared. Try again.');
    } finally {
      if (call === latestCall.current) {
        setBusy(false);
        // The request box was disabled while busy, which drops its focus.
        refocus();
      }
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
  // Row actions wait while a change is prepared or reviewed, so Save never works from an old list.
  const idle = !proposal && !busy;

  return (
    <SettingsSubdialog
      wide
      title="Writing preferences"
      description="How Yap Yap writes for you when it cleans up your dictation. Ask for a change in your own words."
      onClose={onClose}
      // Escape backs out of a change waiting for review first, so it is never lost unseen.
      onEscape={proposal ? () => { setProposal(undefined); input.current?.focus(); } : onClose}
    >
      <div className="yy-pref-editor">
        {!cleanupEnabled && (
          <p className="yy-pref-note">AI cleanup is off in Settings, so your rules and learned style are not applied right now.</p>
        )}

        <section className="yy-pref-section" aria-labelledby={rulesHeadingId}>
          <div className="yy-pref-heading">
            <h3 id={rulesHeadingId}>Your rules</h3>
            <p>Yap Yap always follows these. A rule for one kind of place applies when Yap Yap can tell you're writing there.</p>
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
                  {idle && (
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
                        <span><span className="sr-only">Corrected style: </span>{describeStyle({ ...profile, ...next })}</span>
                      </div>
                    </li>,
                  ];
                }
                return [
                  <li key={profile.category} data-category={profile.category} data-focused={focused === profile.category || undefined}>
                    <CategoryIcon category={profile.category} />
                    <div>
                      <strong>
                        {profile.category}
                        {profile.corrected && <em className="yy-pref-scope">Corrected by you</em>}
                      </strong>
                      <span>{describeStyle(profile)}</span>
                      {updateFor(profile.category) && idle && (
                        <div className="yy-pref-drift">
                          <p>
                            Your recent {profile.category} writing looks different:{' '}
                            <strong>{describeStyle({ ...profile, ...updateFor(profile.category) })}</strong>
                          </p>
                          <div>
                            <button
                              type="button"
                              className="yy-pref-button"
                              data-primary
                              onClick={() => decideUpdate(profile.category, true)}
                            >
                              Update
                            </button>
                            <button
                              type="button"
                              className="yy-pref-button"
                              onClick={() => decideUpdate(profile.category, false)}
                            >
                              Keep mine
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    {profile.corrected && idle && (
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
                    {idle && (
                      <button
                        type="button"
                        aria-label={`Forget what Yap Yap learned for ${profile.category}`}
                        title="Forget"
                        onClick={() => {
                          const forgotten = onForgetStyle(profile.category);
                          setUndo(() => () => onRestoreStyle(forgotten));
                          setError(undefined);
                          setNotice(`Forgot the ${profile.category} style.`);
                          refocus();
                        }}
                      >
                        <X aria-hidden="true" size={14} />
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

        {/* Stays at the bottom of the dialog while the lists scroll behind it. */}
        <div className="yy-pref-dock">
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
              onClick={() => saveProposal(proposal)}
            >
              Save
            </button>
          </div>
        )}

        {/* Only the message is live. Undo sits beside it, so it is not read out as part of it. */}
        <div className="yy-pref-status">
          <span role="status">
            {notice}
            {proposal && <span className="sr-only">A change is ready. Review it above, then save or discard it.</span>}
          </span>
          {notice && undo && (
            <button
              type="button"
              onClick={() => {
                undo();
                setUndo(undefined);
                setNotice('Change undone.');
                refocus();
              }}
            >
              Undo
            </button>
          )}
        </div>

        {provider && !request && !proposal && !busy && (
          <div className="yy-pref-suggestions">
            {suggestions.map(({ label, request: text }) => (
              <button
                key={label}
                type="button"
                title={text}
                onClick={() => {
                  setRequest(text);
                  setError(undefined);
                  input.current?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
        </div>
      </div>
    </SettingsSubdialog>
  );
}
