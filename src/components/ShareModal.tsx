import { useMemo, useState } from 'react';
import { ChevronDown, Copy, Download, X } from 'lucide-react';
import {
  InsightsStats,
  buildHeatmapWeeks,
  formatDurationParts,
  formatWordCount,
} from '../services/stats';
import { HistoryItem } from '../types/app';
import {
  ShareTemplate,
  copyCanvasImage,
  downloadCanvasImage,
  renderShareCardToCanvas,
} from '../utils/shareCard';
import { YapLogo } from './YapLogo';

interface Props {
  open: boolean;
  onClose: () => void;
  stats: InsightsStats;
  history: HistoryItem[];
  onShowToast: (msg: string) => void;
}

export function ShareModal({ open, onClose, stats, history, onShowToast }: Props) {
  const [template, setTemplate] = useState<ShareTemplate>('insights');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const weeks = useMemo(() => buildHeatmapWeeks(history, new Date(), 28), [history]);

  if (!open) return null;

  const wordsFmt = formatWordCount(stats.totalWords);
  const saved = formatDurationParts(stats.timeSavedMinutes);
  const totalTime = formatDurationParts(stats.totalDictationMinutes);
  const visibleWeeks = weeks.slice(-14);

  const levelBg = ['#f1f5f9', '#dbeafe', '#93c5fd', '#3b82f6', '#1d64f2'];

  const handleCopyImage = async () => {
    try {
      const canvas = renderShareCardToCanvas(template, stats, weeks);
      await copyCanvasImage(canvas);
      onShowToast('Insights card copied to clipboard!');
    } catch {
      onShowToast('Clipboard image copy unavailable — use Download image.');
    }
  };

  const handleDownload = () => {
    const canvas = renderShareCardToCanvas(template, stats, weeks);
    downloadCanvasImage(canvas, `yap-yap-${template}.png`);
    setDropdownOpen(false);
    onShowToast('Image downloaded!');
  };

  const handleShareOnX = async () => {
    await handleCopyImage();
    setDropdownOpen(false);
    const text = encodeURIComponent(
      `I've dictated ${wordsFmt.value} ${wordsFmt.unit} at ${stats.averageWpm} WPM using Yap Yap!`
    );
    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank');
  };

  const templates: { id: ShareTemplate; label: string }[] = [
    { id: 'insights', label: 'My insights' },
    { id: 'highlights', label: 'My highlights' },
    { id: 'activity', label: 'My activity' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1.5px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[920px] h-[630px] max-h-[92vh] rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-2xl flex overflow-hidden relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-7 h-7 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] text-[var(--text-secondary)] flex items-center justify-center"
          aria-label="Close share modal"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Left Template Picker matching Image 12 */}
        <div className="yy-side-surface w-[186px] shrink-0 bg-[var(--bg-modal-sidebar)] border-r border-[var(--border-subtle)] p-4 space-y-4 overflow-y-auto">
          {templates.map((t) => {
            const active = template === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                className={`w-full p-2 rounded-xl text-center transition-colors ${
                  active
                    ? 'bg-[var(--bg-active-nav)]'
                    : 'hover:bg-[var(--bg-hover)]'
                }`}
              >
                <div className="w-full aspect-[4/3] rounded-lg bg-gradient-to-br from-sky-200/80 via-slate-100 to-sky-100 p-2 flex flex-col justify-center gap-1 border border-black/5">
                  {t.id !== 'activity' && (
                    <div className="grid grid-cols-2 gap-1">
                      <div className="h-3.5 rounded bg-white/90" />
                      <div className="h-3.5 rounded bg-white/90" />
                    </div>
                  )}
                  {t.id !== 'highlights' && (
                    <div className="h-6 rounded bg-white/90" />
                  )}
                </div>
                <div className="text-[12px] font-medium text-[var(--text-primary)] mt-1.5">
                  {t.label}
                </div>
              </button>
            );
          })}
        </div>

        {/* Center Preview + Actions */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto bg-[var(--bg-main)]">
          {/* Sky-gradient Card Preview */}
          <div className="w-full max-w-[490px] rounded-2xl p-6 shadow-lg border border-black/5 bg-gradient-to-br from-[#c9e4fb] via-[#eef5fc] to-[#d9ecfb] text-[#141416]">
            <h3 className="text-[24px] font-bold text-center tracking-tight mb-4">
              {template === 'insights'
                ? 'My Yap Yap insights'
                : template === 'highlights'
                ? 'My Yap Yap highlights'
                : 'My Yap Yap activity'}
            </h3>

            {template !== 'activity' && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-xl bg-white/90 p-3.5 shadow-xs">
                  <div className="text-[20px] font-bold leading-none">
                    {wordsFmt.value}{' '}
                    <span className="text-[11px] font-semibold">{wordsFmt.unit}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1.5">Words dictated</div>
                </div>
                <div className="rounded-xl bg-white/90 p-3.5 shadow-xs">
                  <div className="text-[20px] font-bold leading-none">
                    {saved.firstVal}{' '}
                    <span className="text-[11px] font-semibold">{saved.firstUnit}</span>{' '}
                    {saved.secondVal}{' '}
                    <span className="text-[11px] font-semibold">{saved.secondUnit}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1.5">Time saved</div>
                </div>
                <div className="rounded-xl bg-white/90 p-3.5 shadow-xs">
                  <div className="text-[20px] font-bold leading-none">
                    {stats.averageWpm} <span className="text-[11px] font-semibold">WPM</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1.5">
                    Average dictation speed
                  </div>
                </div>
                <div className="rounded-xl bg-white/90 p-3.5 shadow-xs">
                  <div className="text-[20px] font-bold leading-none">
                    {totalTime.firstVal}{' '}
                    <span className="text-[11px] font-semibold">{totalTime.firstUnit}</span>{' '}
                    {totalTime.secondVal}{' '}
                    <span className="text-[11px] font-semibold">{totalTime.secondUnit}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1.5">
                    Total dictation time
                  </div>
                </div>
              </div>
            )}

            {template !== 'highlights' && (
              <div className="rounded-xl bg-white/90 p-4 shadow-xs flex items-center justify-between gap-4">
                <div className="space-y-2.5 shrink-0">
                  <div>
                    <div className="text-[18px] font-bold leading-none">
                      {stats.activeDays}{' '}
                      <span className="text-[10.5px] font-semibold">days</span>
                    </div>
                    <div className="text-[10.5px] text-zinc-500 mt-0.5">Active days</div>
                  </div>
                  <div>
                    <div className="text-[18px] font-bold leading-none">
                      {stats.currentStreak}{' '}
                      <span className="text-[10.5px] font-semibold">days</span>
                    </div>
                    <div className="text-[10.5px] text-zinc-500 mt-0.5">Current streak</div>
                  </div>
                  <div>
                    <div className="text-[18px] font-bold leading-none">
                      {stats.longestStreak}{' '}
                      <span className="text-[10.5px] font-semibold">days</span>
                    </div>
                    <div className="text-[10.5px] text-zinc-500 mt-0.5">Longest streak</div>
                  </div>
                </div>

                <div className="grid grid-flow-col auto-cols-fr gap-1">
                  {visibleWeeks.map((wk, wi) => (
                    <div key={wi} className="flex flex-col gap-1">
                      {wk.days.map((day) => (
                        <span
                          key={day.dateKey}
                          style={{
                            backgroundColor: day.hatched
                              ? '#f4f4f5'
                              : levelBg[day.level],
                          }}
                          className="w-3 h-3 rounded-[3px] block"
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mt-3.5 text-[11px] font-semibold text-zinc-700">
              <span className="inline-flex items-center gap-1.5">
                <YapLogo className="w-3.5 h-3.5" />
                <span>Yap Yap</span>
              </span>
              <span className="text-zinc-500 font-medium">yapyap.app</span>
            </div>
          </div>

          {/* Action Buttons matching Image 12 */}
          <div className="flex items-center gap-2.5 mt-5 relative">
            <button
              type="button"
              onClick={handleCopyImage}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-[13.5px] font-semibold hover:opacity-90 transition-opacity shadow-sm"
            >
              <Copy className="w-4 h-4" />
              <span>Copy image</span>
            </button>

            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-3.5 py-2.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] transition-colors"
              aria-label="More share options"
            >
              <Download className="w-4 h-4" />
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {dropdownOpen && (
              <div className="absolute bottom-14 right-0 w-72 rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-2xl py-2 z-30">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="w-full px-4 py-2.5 text-left text-[13.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2.5"
                >
                  <Download className="w-4 h-4 text-[var(--text-secondary)]" />
                  <span>Download image</span>
                </button>
                <button
                  type="button"
                  onClick={handleShareOnX}
                  className="w-full px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] flex items-start gap-2.5"
                >
                  <span className="w-5 h-5 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    𝕏
                  </span>
                  <div>
                    <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                      Share on X
                    </div>
                    <div className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
                      Press <kbd className="yy-keycap text-[10px]">Ctrl</kbd>{' '}
                      <kbd className="yy-keycap text-[10px]">V</kbd> to paste the image into your post
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
