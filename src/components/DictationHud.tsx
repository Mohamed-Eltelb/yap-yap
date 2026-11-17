import { useEffect, useState } from 'react';
import { Check, ChevronsUpDown, Copy, Mic, Sparkles, X } from 'lucide-react';
import type { AppearanceMode, DictationMode } from '../types/app';
import { AnswerMarkdown } from './AnswerMarkdown';
import { YapLogo } from './YapLogo';

export interface HudState {
  status: 'idle' | 'armed' | 'recording' | 'processing' | 'cancelled' | 'notice' | 'result' | 'error';
  mode: DictationMode;
  levels: number[];
  resultText?: string;
  questionText?: string;
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
}

const modeLabels: Record<DictationMode, string> = { dictate: 'Dictate', translate: 'Translate', ask: 'Ask anything' };

interface Props {
  hud: HudState;
  onStop: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRetry: () => void;
  onSelectTarget: (target: string) => void;
  onEditTargets: () => void;
  onCopyResult: (text: string) => void;
  onDismissResult: () => void;
}

const bars = [0.22, 0.37, 0.49, 0.67, 0.79, 1, 0.75, 0.55, 0.4, 0.32, 0.2];

export function DictationHud({
  hud,
  onStop,
  onCancel,
  onUndo,
  onRetry,
  onSelectTarget,
  onEditTargets,
  onCopyResult,
  onDismissResult,
}: Props) {
  const [showTargets, setShowTargets] = useState(false);
  useEffect(() => {
    if (hud.status !== 'recording' || hud.mode !== 'translate') setShowTargets(false);
  }, [hud.status, hud.mode]);

  if (hud.status === 'idle') return null;

  const { questionText, resultText } = hud;
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
          <div className="yy-hud-pill" role="group" aria-label="Recording controls">
            <button type="button" className="yy-hud-cancel" aria-label="Cancel recording" onClick={onCancel}>
              <X size={16} aria-hidden="true" />
            </button>
            <div className="yy-hud-wave" aria-hidden="true">
              {bars.map((weight, index) => {
                // The center bars show the low, loudest part of the voice; each side a bit apart.
                const center = (bars.length - 1) / 2;
                const band = Math.abs(index - center) * 3 + (index > center ? 1 : 0);
                const level = hud.levels[Math.min(hud.levels.length - 1, band)] ?? 0;
                return <span key={index} style={{ height: `${2 + Math.min(1, Math.max(0, level)) * weight * 17}px` }} />;
              })}
            </div>
            <button type="button" className="yy-hud-confirm" aria-label="Finish recording" onClick={onStop}>
              <Check size={17} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
      {hud.status === 'armed' && !hud.shortcutList && (
        <div className="yy-hud-pill yy-hud-armed" role="status" aria-label="Waiting for shortcut">
          <div className="yy-hud-wave" aria-hidden="true">
            {bars.map((_, index) => <span key={index} style={{ height: '2px' }} />)}
          </div>
        </div>
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
      {hud.status === 'processing' && (
        <div className="yy-hud-thinking" role="status">
          <span>Thinking</span>
        </div>
      )}
      {hud.status === 'notice' && (
        <div className="yy-hud-cancelled yy-hud-notice" role="status">
          <span>{hud.noticeText}</span>
        </div>
      )}
      {hud.status === 'cancelled' && (
        <div className="yy-hud-cancelled" role="status">
          <span>Transcript cancelled</span>
          <button type="button" onClick={onUndo}>Undo</button>
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
              <button type="button" className="yy-hud-icon" aria-label="Copy question" onClick={() => onCopyResult(questionText)}><Copy size={15} /></button>
            </div>
          )}
          <div className="yy-hud-answer-card">
            <header><Sparkles size={16} aria-hidden="true" /><h2>Answer</h2>
              {resultText && <button type="button" className="yy-hud-icon" aria-label="Copy answer" onClick={() => onCopyResult(resultText)}><Copy size={15} /></button>}
            </header>
            <AnswerMarkdown text={resultText} className="yy-hud-answer-content" />
          </div>
        </section>
      )}
      {(hud.status === 'error' || (hud.status === 'result' && hud.mode !== 'ask')) && (
        <section className="yy-hud-message" aria-label={hud.status === 'error' ? 'Recording error' : 'Recording result'}>
          <header>
            <span>{hud.mode === 'translate' ? 'Translate' : hud.mode === 'ask' ? 'Ask anything' : 'Dictate'}</span>
            <button type="button" className="yy-hud-icon" aria-label="Dismiss" onClick={onDismissResult}><X size={16} /></button>
          </header>
          <p dir="auto" role={hud.status === 'error' ? 'alert' : undefined}>{hud.status === 'error' ? hud.errorText : resultText}</p>
          {hud.status === 'error' && (
            <button type="button" className="yy-hud-retry" onClick={onRetry}>Try again</button>
          )}
          {hud.status === 'result' && resultText && (
            <button type="button" className="yy-hud-icon" aria-label="Copy result" onClick={() => onCopyResult(resultText)}><Copy size={15} /></button>
          )}
        </section>
      )}
    </div>
  );
}
