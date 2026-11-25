import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Copy, Globe, Mic, Pause, Play, Sparkles, X } from 'lucide-react';
import type { AppearanceMode, DictationMode } from '../types/app';
import { AnswerMarkdown } from './AnswerMarkdown';
import { answerAsPlainText } from '../utils/answerText';
import { YapLogo } from './YapLogo';
import { SelectionQuote } from './SelectionQuote';

export interface HudState {
  status: 'idle' | 'armed' | 'recording' | 'processing' | 'cancelled' | 'notice' | 'result' | 'error';
  mode: DictationMode;
  levels: number[];
  resultText?: string;
  /** Windows rewrite result when the answer card stays open. */
  rewritePaste?: 'unverified' | 'not-sent';
  questionText?: string;
  /** Ask anything: the selected text the question was about. */
  selectionText?: string;
  /** The Ask anything answer used a web search. */
  searchedWeb?: boolean;
  /** While processing: the provider is searching the web for the Ask anything answer. */
  searchingWeb?: boolean;
  errorText?: string;
  targets?: string[];
  targetLanguage?: string;
  appearance?: AppearanceMode;
  /** Shown while the shortcut key is held long enough to ask for it. */
  shortcutList?: { mode: DictationMode; combos: string[][] }[];
  /** The shortcut was pressed while this dictation was still processing. */
  busyNotice?: boolean;
  /** A short note shown in place of a result, such as when nothing was said. */
  noticeText?: string;
  /** The recording is paused: nothing is captured until it resumes. */
  paused?: boolean;
  /** Shown on the first recording after the app starts: how to pause. `keys` is the shortcut to hold, if any. */
  pauseTip?: { keys?: string[] };
}

const modeLabels: Record<DictationMode, string> = { dictate: 'Dictate', translate: 'Translate', ask: 'Ask anything' };

interface Props {
  hud: HudState;
  onStop: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onUndo: () => void;
  onRetry: () => void;
  onSelectTarget: (target: string) => void;
  onEditTargets: () => void;
  onCopyResult: (text: string) => void;
  onDismissResult: () => void;
  /** Keeps the translation target menu open, for a still preview of the HUD. */
  targetsOpen?: boolean;
}

// Tallest in the middle, lower toward the edges.
export const bars = [0.4, 0.55, 0.7, 0.85, 0.95, 1, 0.95, 0.85, 0.7, 0.55, 0.4];
// The voice band each bar follows: the strongest bands in the middle, and
// neighbours on different bands so each bar moves on its own.
const barBands = [9, 5, 7, 3, 1, 0, 2, 4, 6, 8, 10];

/** How long the pill takes to shrink out after the HUD closes. */
export const PILL_CLOSE_MS = 200;
/** How long the pause tip stays; it fades out over its last quarter second (see .yy-hud-tip). */
export const PAUSE_TIP_MS = 6000;

/** A small copy of the Finish button, for pointing at it in text. */
const finishIcon = (
  <span className="yy-hud-tip-finish" aria-label="Finish" role="img">
    <Check size={11} strokeWidth={2.75} aria-hidden="true" />
  </span>
);

/**
 * A small copy of the Pause button that hovering Finish reveals. The circle and bars are
 * one SVG so they snap to screen pixels together; a separate icon inside a circle drifts
 * half a pixel off centre at 125% display scaling.
 */
const pauseIcon = (
  <svg className="yy-hud-tip-pause" role="img" aria-label="Pause" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="8" fill="#404142" />
    <rect x="5.1" y="4.6" width="2.2" height="6.8" rx="0.7" fill="#fff" />
    <rect x="8.7" y="4.6" width="2.2" height="6.8" rx="0.7" fill="#fff" />
  </svg>
);

/** How long each word shows in the Thinking pill. */
export const THINKING_WORD_MS = 2400;
/** The Thinking pill starts on "Thinking", then moves through these in random order. */
const thinkingWords = [
  'Transcribing', 'Yapping', 'Untangling', 'Polishing', 'Wordsmithing', 'Decoding',
  'Tidying up', 'Punctuating', 'Pondering', 'Proofreading', 'Distilling', 'Unmumbling',
  'Noodling', 'Riffing', 'Cooking',
];
/** The Thinking pill is never narrower than this, so short words do not shrink it. */
const THINKING_MIN_WIDTH = 100;
/** Room around the word inside the Thinking pill. */
const THINKING_PADDING = 40;

function nextThinkingWord(current: string): string {
  const choices = thinkingWords.filter((word) => word !== current);
  return choices[Math.floor(Math.random() * choices.length)];
}

/** What the Thinking pill says while an Ask anything answer is searching the web. */
export const SEARCHING_LABEL = 'Searching the web';

/**
 * The Thinking pill's word. It changes while `active`, and starts over on "Thinking" each time.
 * While `searching` it holds on "Searching the web" instead.
 */
function ThinkingLabel({ active, searching, onWidth }: { active: boolean; searching: boolean; onWidth: (width: number) => void }) {
  const [word, setWord] = useState('Thinking');
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setWord('Thinking');
  }
  useEffect(() => {
    if (!active || searching) return;
    const timer = window.setInterval(() => setWord(nextThinkingWord), THINKING_WORD_MS);
    return () => window.clearInterval(timer);
  }, [active, searching]);
  const shown = searching ? SEARCHING_LABEL : word;
  const wordRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (active && wordRef.current) onWidth(wordRef.current.offsetWidth);
  }, [active, shown, onWidth]);
  return (
    <span className="yy-hud-pill-label" aria-hidden="true">
      {/* A new key remounts the word, so each one slides in. */}
      <span key={shown} ref={wordRef} className="yy-hud-pill-word">{shown}</span>
    </span>
  );
}

export type PillState = 'armed' | 'recording' | 'paused' | 'thinking' | 'closing';

/** The pill shape a HUD state uses, or nothing when that state shows another screen. */
export function pillStateFor(hud: HudState): PillState | undefined {
  if (hud.status === 'armed') return hud.shortcutList ? undefined : 'armed';
  if (hud.status === 'recording') return hud.paused ? 'paused' : 'recording';
  if (hud.status === 'processing') return 'thinking';
  return undefined;
}

/** How loud the voice is now, from its loudest bands. */
export function loudness(levels: number[]): number {
  const top = [...levels].sort((a, b) => b - a).slice(0, 4);
  return top.length ? top.reduce((sum, value) => sum + value, 0) / top.length : 0;
}

/** A bar's height: mostly its own band, partly the overall voice, flat in silence. */
export function barHeight(levels: number[], index: number, loud: number): number {
  const own = levels[barBands[index]] ?? 0;
  const level = Math.max(0, 0.65 * own + 0.35 * loud - 0.06);
  return 2 + Math.min(1, level) * bars[index] * 20;
}

/** How long a copy button shows its check mark after copying. */
export const COPIED_MS = 1500;

/** A copy button that briefly turns into a check mark to confirm the copy. */
function CopyButton({ label, onCopy }: { label: string; onCopy: () => void }) {
  // Counts copies, so clicking again while the check mark shows restarts its timer.
  const [copies, setCopies] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copies) return;
    setCopied(true);
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copies]);
  return (
    <button type="button" className="yy-hud-icon" aria-label={copied ? 'Copied' : label} data-copied={copied || undefined}
      onClick={() => {
        onCopy();
        setCopies((count) => count + 1);
      }}>
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    </button>
  );
}

export function DictationHud({
  hud,
  onStop,
  onCancel,
  onPause,
  onResume,
  onUndo,
  onRetry,
  onSelectTarget,
  onEditTargets,
  onCopyResult,
  onDismissResult,
  targetsOpen = false,
}: Props) {
  const [hoveredTargets, setShowTargets] = useState(false);
  const showTargets = hoveredTargets || targetsOpen;
  useEffect(() => {
    if (hud.status !== 'recording' || hud.mode !== 'translate') setShowTargets(false);
  }, [hud.status, hud.mode]);

  // When the HUD closes from a pill, the pill shrinks out before it goes. This is
  // worked out during render, so the same pill element stays and its shrink animates.
  const [thinkingWordWidth, setThinkingWordWidth] = useState(0);
  const livePill = pillStateFor(hud);
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState({ pill: livePill, status: hud.status });
  if (shown.pill !== livePill || shown.status !== hud.status) {
    setShown({ pill: livePill, status: hud.status });
    setClosing(!livePill && hud.status === 'idle' && (shown.pill !== undefined || closing));
  }
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setClosing(false), PILL_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  if (hud.status === 'idle' && !closing) return null;

  const { questionText, resultText } = hud;
  const loud = Math.min(1, Math.max(0, loudness(hud.levels)));
  const pill = livePill ?? (closing ? 'closing' : undefined);
  const recording = pill === 'recording';
  const live = recording || pill === 'paused';
  /** Hidden buttons stay in the pill for its animations, out of reach. */
  const reach = (on: boolean) => ({ disabled: !on, tabIndex: on ? undefined : -1, 'aria-hidden': on ? undefined : true });
  const targets = hud.targets ?? [];
  const selectedTarget = hud.targetLanguage && targets.includes(hud.targetLanguage)
    ? hud.targetLanguage : targets[0] ?? 'English';

  const targetMenu = hud.mode === 'translate' && showTargets && (
    <div className="yy-hud-targets" role="group" aria-label="Translation target">
      {targets.length < 3 && (
        <button type="button" className="yy-hud-edit-targets" onClick={() => {
          setShowTargets(false);
          onEditTargets();
        }}>Add another language</button>
      )}
      {targets.map((target) => (
        <button key={target} type="button" aria-pressed={target === selectedTarget} onClick={(event) => {
          event.currentTarget.closest('.yy-hud-translate')?.querySelector('button')?.focus();
          setShowTargets(false);
          onSelectTarget(target);
        }}>{target}</button>
      ))}
    </div>
  );

  return (
    <div className="yy-hud" data-mode={hud.mode}>
      {hud.status === 'recording' && (
        <>
          {hud.mode === 'ask' && <div className="yy-hud-mode">Ask anything</div>}
          {hud.mode === 'translate' && (
            <div
              className="yy-hud-mode yy-hud-translate"
              onMouseEnter={() => setShowTargets(true)}
              onMouseLeave={() => setShowTargets(false)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setShowTargets(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && showTargets) {
                  event.stopPropagation();
                  event.currentTarget.querySelector('button')?.focus();
                  setShowTargets(false);
                }
              }}
            >
              <span>Translating to</span>
              <button
                type="button"
                className="yy-hud-target"
                aria-expanded={showTargets}
                onFocus={(event) => {
                  if (event.currentTarget.matches(':focus-visible')) setShowTargets(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    setShowTargets(true);
                  }
                }}
              >
                <span>{selectedTarget}</span><ChevronsUpDown size={11} aria-hidden="true" />
              </button>
              {targetMenu}
            </div>
          )}
        </>
      )}
      {hud.status === 'armed' && hud.shortcutList && (
        <section className="yy-hud-shortcuts" aria-label="Shortcuts">
          {hud.shortcutList.map(({ mode, combos }) => (
            <div key={mode} className="yy-hud-shortcut">
              <span>{modeLabels[mode]}</span>
              <kbd>{combos.map((combo) => combo.join(' + ')).join(' or ')}</kbd>
            </div>
          ))}
        </section>
      )}
      {hud.status === 'processing' && hud.busyNotice && (
        <section className="yy-hud-busy" role="alert">
          <strong>Yap Yap is still processing your last dictation</strong>
          <p>Press Esc or click Cancel to cancel it.</p>
          <button type="button" onClick={onCancel}>Cancel</button>
        </section>
      )}
      {hud.status === 'recording' && hud.pauseTip && !hud.paused && (
        <p className="yy-hud-tip" role="status">
          {hud.pauseTip.keys
            ? <>Hold <kbd>{hud.pauseTip.keys.join(' + ')}</kbd> to pause, or hover {finishIcon} and click {pauseIcon}</>
            : <>Hover {finishIcon} and click {pauseIcon} to pause the recording</>}
        </p>
      )}
      {pill && (
        <div
          className="yy-hud-pill"
          data-state={pill}
          role={pill === 'recording' ? 'group' : 'status'}
          aria-label={pill === 'recording' ? 'Recording controls' : pill === 'armed' ? 'Waiting for shortcut' : pill === 'thinking' ? (hud.searchingWeb ? SEARCHING_LABEL : 'Thinking') : undefined}
          // The Thinking pill fits its current word; the other shapes have fixed widths in CSS.
          style={pill === 'thinking' && thinkingWordWidth
            ? { width: Math.max(THINKING_MIN_WIDTH, thinkingWordWidth + THINKING_PADDING) }
            : undefined}
        >
          <button type="button" className="yy-hud-cancel" aria-label="Cancel recording" onClick={onCancel} {...reach(live)}>
            <X size={16} aria-hidden="true" />
          </button>
          <div className="yy-hud-wave" aria-hidden="true">
            {bars.map((_, index) => (
              <span key={index} style={{
                height: `${recording ? barHeight(hud.levels, index, loud) : 2}px`,
                // The bars fade in from the center outward.
                transitionDelay: `0ms, ${Math.abs(index - (bars.length - 1) / 2) * 35}ms`,
              }} />
            ))}
          </div>
          <span className="yy-hud-pill-paused" aria-hidden={pill === 'paused' ? undefined : true}>
            Paused
          </span>
          {/* The main action stays put; hovering it slides the other one out beside it. */}
          <div className="yy-hud-actions">
            <button type="button" className="yy-hud-pause" aria-label="Pause recording" onClick={onPause} {...reach(recording)}>
              <Pause size={15} aria-hidden="true" />
            </button>
            <button type="button" className="yy-hud-confirm" aria-label="Finish recording" onClick={onStop} {...reach(live)}>
              <Check size={17} aria-hidden="true" />
            </button>
            <button type="button" className="yy-hud-resume" aria-label="Resume recording" onClick={onResume} {...reach(pill === 'paused')}>
              <Play size={15} aria-hidden="true" />
            </button>
          </div>
          <ThinkingLabel active={pill === 'thinking'} searching={pill === 'thinking' && !!hud.searchingWeb} onWidth={setThinkingWordWidth} />
        </div>
      )}
      {hud.status === 'notice' && (
        <div className="yy-hud-cancelled yy-hud-notice" role="status">
          <span>{hud.noticeText}</span>
        </div>
      )}
      {hud.status === 'cancelled' && (
        <div
          className="yy-hud-cancelled yy-hud-countdown"
          role="status"
          onAnimationEnd={(event) => {
            // The ring runs down, the notice fades out, then it goes. Hovering pauses both.
            if (event.animationName === 'yy-hud-notice-out') onDismissResult();
          }}
        >
          <span>Transcript cancelled</span>
          <button type="button" onClick={onUndo}>
            <svg className="yy-hud-undo-ring" aria-hidden="true"><rect pathLength={100} /></svg>
            Undo
          </button>
        </div>
      )}
      {hud.status === 'result' && hud.mode === 'ask' && (
        <section className="yy-hud-answer" aria-label="Ask anything result">
          <header className="yy-hud-answer-brand">
            <span><YapLogo className="size-5" />Yap Yap</span>
            <button type="button" className="yy-hud-icon" aria-label="Close answer" onClick={onDismissResult}><X size={17} /></button>
          </header>
          {questionText && (
            <div className="yy-hud-question">
              <Mic size={15} aria-hidden="true" />
              <p dir="auto">{questionText}</p>
              <CopyButton label="Copy question" onCopy={() => onCopyResult(questionText)} />
            </div>
          )}
          {hud.selectionText && <SelectionQuote text={hud.selectionText} className="yy-hud-selection" />}
          <div className="yy-hud-answer-card">
            <header><Sparkles size={16} aria-hidden="true" /><h2>{hud.rewritePaste ? 'Rewrite' : 'Answer'}</h2>
              {hud.searchedWeb && <span className="yy-hud-answer-source"><Globe size={13} aria-hidden="true" />Searched the web</span>}
              {resultText && <CopyButton label={hud.rewritePaste ? 'Copy rewrite' : 'Copy answer'}
                onCopy={() => onCopyResult(hud.rewritePaste ? resultText : answerAsPlainText(resultText))} />}
            </header>
            {hud.rewritePaste && <p className="yy-hud-rewrite-status" role="status">
              {hud.rewritePaste === 'unverified' ? 'Paste sent. Check that your text was replaced.' : 'The rewrite couldn’t be pasted.'}
            </p>}
            <AnswerMarkdown text={resultText} className="yy-hud-answer-content" />
          </div>
        </section>
      )}
      {(hud.status === 'error' || (hud.status === 'result' && hud.mode !== 'ask')) && (
        <section className="yy-hud-message" aria-label={hud.status === 'error' ? 'Recording error' : 'Recording result'}>
          <header>
            <span>{hud.mode === 'translate' ? 'Translate' : hud.mode === 'ask' ? 'Ask anything' : 'Dictate'}</span>
            {hud.status === 'result' && resultText && (
              <CopyButton label="Copy result" onCopy={() => onCopyResult(resultText)} />
            )}
            <button type="button" className="yy-hud-icon" aria-label="Dismiss" onClick={onDismissResult}><X size={16} /></button>
          </header>
          <p dir="auto" role={hud.status === 'error' ? 'alert' : undefined}>{hud.status === 'error' ? hud.errorText : resultText}</p>
          {hud.status === 'error' && (
            <button type="button" className="yy-hud-retry" onClick={onRetry}>Try again</button>
          )}
        </section>
      )}
    </div>
  );
}
