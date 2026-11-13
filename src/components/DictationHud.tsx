import {
  Check,
  Copy,
  Languages,
  Loader2,
  Mic,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { DictationMode } from '../types/app';

export interface HudState {
  status: 'idle' | 'recording' | 'processing' | 'result' | 'error';
  mode: DictationMode;
  levels: number[];
  elapsedMs: number;
  resultText?: string;
  errorText?: string;
  providerLabel?: string;
}

interface Props {
  hud: HudState;
  onStop: () => void;
  onCancel: () => void;
  onCopyResult: (text: string) => void;
  onDismissResult: () => void;
}

function formatTimer(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function DictationHud({
  hud,
  onStop,
  onCancel,
  onCopyResult,
  onDismissResult,
}: Props) {
  if (hud.status === 'idle') return null;

  const modeBadge =
    hud.mode === 'dictate'
      ? { label: 'Dictate', icon: <Mic className="w-3.5 h-3.5 text-sky-400" /> }
      : hud.mode === 'translate'
      ? { label: 'Translate', icon: <Languages className="w-3.5 h-3.5 text-emerald-400" /> }
      : { label: 'Ask anything', icon: <Sparkles className="w-3.5 h-3.5 text-violet-400" /> };

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2.5 pointer-events-auto">
      {/* Floating Result / Error Card */}
      {(hud.status === 'result' || hud.status === 'error') && (
        <div className="w-[380px] max-w-[92vw] rounded-2xl bg-[#18181b]/95 text-white border border-white/12 shadow-2xl p-4 backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-zinc-300">
              {modeBadge.icon}
              <span>{modeBadge.label}</span>
              {hud.providerLabel && (
                <span className="text-zinc-500 font-normal">· {hud.providerLabel}</span>
              )}
            </span>
            <button
              type="button"
              onClick={onDismissResult}
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {hud.status === 'error' ? (
            <p className="text-[12.5px] text-red-400 leading-relaxed">
              {hud.errorText}
            </p>
          ) : (
            <>
              <p
                dir="auto"
                className="text-[13px] text-zinc-100 leading-relaxed max-h-44 overflow-y-auto"
              >
                {hud.resultText}
              </p>
              <div className="flex items-center justify-end gap-2 mt-3">
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 mr-auto">
                  <Check className="w-3 h-3" />
                  <span>Copied &amp; saved</span>
                </span>
                <button
                  type="button"
                  onClick={() => hud.resultText && onCopyResult(hud.resultText)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-zinc-900 text-[11.5px] font-semibold hover:bg-zinc-200 transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sleek Floating Pill Capsule */}
      {(hud.status === 'recording' || hud.status === 'processing') && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#141416]/95 text-white border border-white/12 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold pr-1 border-r border-white/10">
            {modeBadge.icon}
            <span>{modeBadge.label}</span>
          </div>

          {hud.status === 'recording' ? (
            <>
              {/* Live Waveform Bars */}
              <div className="flex items-center gap-[3px] h-5 px-1">
                {hud.levels.map((lvl, idx) => (
                  <span
                    key={idx}
                    style={{ height: `${Math.round(4 + lvl * 16)}px` }}
                    className="w-[2.5px] rounded-full bg-white/90 transition-all duration-75"
                  />
                ))}
              </div>

              <span className="text-[11.5px] text-zinc-400 tabular-nums w-9 text-center">
                {formatTimer(hud.elapsedMs)}
              </span>

              <button
                type="button"
                onClick={onStop}
                title="Stop & Transcribe"
                className="w-7 h-7 rounded-full bg-[#1d64f2] hover:bg-[#1556d8] flex items-center justify-center transition-colors"
              >
                <Square className="w-3 h-3 fill-white" />
              </button>

              <button
                type="button"
                onClick={onCancel}
                title="Cancel"
                className="w-6 h-6 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 px-2 text-[12.5px] text-zinc-300">
              <Loader2 className="w-4 h-4 animate-spin text-[#4b8bff]" />
              <span>Processing with {hud.providerLabel ?? 'AI'}…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
