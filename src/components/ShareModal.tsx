import { useMemo, useState } from 'react';
import { ChevronDown, Copy, Download, Share, X } from 'lucide-react';
import { InsightsStats, buildHeatmapWeeks, HeatmapWeek } from '../services/stats';
import { HistoryItem } from '../types/app';
import {
  BODY_FONT,
  CARD,
  HEAT_COLORS,
  HEAT_EMPTY,
  ShareTemplate,
  TITLE_FONT,
  backdropCss,
  cardHeight,
  cardTitle,
  copyCanvasImage,
  downloadCanvasImage,
  renderShareCardToCanvas,
  showsActivity,
  showsStats,
  statParts,
} from '../utils/shareCard';
import { YapLogo } from './YapLogo';

interface Props {
  open: boolean;
  onClose: () => void;
  stats: InsightsStats;
  history: HistoryItem[];
  onShowToast: (msg: string) => void;
}

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const TEMPLATES: { id: ShareTemplate; label: string }[] = [
  { id: 'insights', label: 'My insights' },
  { id: 'highlights', label: 'My highlights' },
  { id: 'activity', label: 'My activity' },
];

function XLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.17h1.7L7.4 4.73H5.58l11.09 14.44Z" />
    </svg>
  );
}

function Bar({ w, h }: { w: number; h: number }) {
  return <span className="block rounded-[4px] bg-[#ececee]" style={{ width: w, height: h }} />;
}

/** The share card at its natural 600px width. `skeleton` swaps text for bars (thumbnails). */
function ShareCard({
  template,
  stats,
  weeks,
  skeleton = false,
}: {
  template: ShareTemplate;
  stats: InsightsStats;
  weeks: HeatmapWeek[];
  skeleton?: boolean;
}) {
  const vis = weeks.slice(-CARD.heatWeeks);
  const parts = statParts(stats);

  const valueRun = (p: [string, boolean][], big: number, small: number) => (
    <div className="flex items-baseline text-[#111113] leading-none" style={{ fontFamily: TITLE_FONT, fontWeight: 700 }}>
      {p.map(([t, isBig], i) => (
        <span
          key={i}
          style={{ fontSize: isBig ? big : small, marginRight: i < p.length - 1 ? (isBig ? 5 : 7) : 0 }}
        >
          {t}
        </span>
      ))}
    </div>
  );

  return (
    <div
      className="relative overflow-hidden text-[#111113]"
      style={{
        width: CARD.width,
        height: cardHeight(template, !skeleton),
        borderRadius: CARD.radius,
        background: backdropCss(template),
        padding: `${CARD.padTop}px ${CARD.padX}px ${CARD.padBottom}px`,
        fontFamily: BODY_FONT,
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.22] mix-blend-multiply"
        style={{ backgroundImage: GRAIN }}
      />
      <div className="relative flex flex-col h-full">
        {skeleton ? (
          <div style={{ height: 4 }} />
        ) : (
          <h3
            className="text-center leading-none tracking-[-0.02em] whitespace-nowrap"
            style={{
              fontFamily: TITLE_FONT,
              fontWeight: 700,
              fontSize: CARD.titleSize,
              height: CARD.titleSize,
              marginBottom: CARD.titleGap,
            }}
          >
            {cardTitle(template)}
          </h3>
        )}

        {showsStats(template) && (
          <div
            className="grid grid-cols-2"
            style={{ gap: CARD.gap, marginBottom: showsActivity(template) ? CARD.gap : 0 }}
          >
            {parts.map((s) => (
              <div
                key={s.label}
                className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(15,23,42,0.05)] flex flex-col justify-between"
                style={{ height: CARD.statH, padding: '20px 18px 16px' }}
              >
                {skeleton ? (
                  <>
                    <Bar w={130} h={22} />
                    <Bar w={90} h={14} />
                  </>
                ) : (
                  <>
                    {valueRun(s.parts, 28, 15)}
                    <div className="text-[13px] text-[#7a7a82] leading-none">{s.label}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {showsActivity(template) && (
          <div
            className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(15,23,42,0.05)] flex items-center justify-between"
            style={{ height: CARD.activityH, padding: '0 22px 0 24px' }}
          >
            <div className="flex flex-col" style={{ gap: 20 }}>
              {[
                { v: stats.activeDays, l: 'Active days' },
                { v: stats.currentStreak, l: 'Current streak' },
                { v: stats.longestStreak, l: 'Longest streak' },
              ].map((r) =>
                skeleton ? (
                  <div key={r.l} className="flex flex-col gap-2">
                    <Bar w={110} h={14} />
                    <Bar w={80} h={10} />
                  </div>
                ) : (
                  <div key={r.l}>
                    {valueRun([[`${r.v}`, true], ['days', false]], 24, 13)}
                    <div className="text-[12.5px] text-[#7a7a82] leading-none mt-2">{r.l}</div>
                  </div>
                )
              )}
            </div>

            <div>
              <div className="flex">
                <div
                  className="flex flex-col text-[9px] font-medium text-[#8a8a92]"
                  style={{ width: CARD.dayLabelW, gap: CARD.cellGap }}
                >
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                    <span key={i} className="flex items-center" style={{ height: CARD.cell }}>
                      {d}
                    </span>
                  ))}
                </div>
                <div className="flex" style={{ gap: CARD.cellGap }}>
                  {vis.map((wk, wi) => (
                    <div key={wi} className="flex flex-col" style={{ gap: CARD.cellGap }}>
                      {wk.days.map((day) => (
                        <span
                          key={day.dateKey}
                          className="block rounded-[3.5px]"
                          style={{
                            width: CARD.cell,
                            height: CARD.cell,
                            background: day.future
                              ? '#ffffff'
                              : day.hatched
                              ? HEAT_EMPTY
                              : HEAT_COLORS[day.level],
                            boxShadow: day.future ? 'inset 0 0 0 1px #e4e4e7' : undefined,
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex mt-1.5" style={{ paddingLeft: CARD.dayLabelW, gap: CARD.cellGap }}>
                {vis.map((wk, wi) => (
                  <span
                    key={wi}
                    className="text-[9px] font-medium text-[#8a8a92] text-center whitespace-nowrap"
                    style={{ width: CARD.cell }}
                  >
                    {wi > 0 ? wk.monthLabel ?? '' : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between" style={{ height: CARD.footerH }}>
          <span className="inline-flex items-center gap-[3px]">
            <YapLogo className="w-5 h-5 text-[#111113]" />
            <span className="text-[18px] leading-none" style={{ fontFamily: TITLE_FONT, fontWeight: 700 }}>
              Yap Yap
            </span>
          </span>
          <span className="text-[14px] text-[#6b6b73]">yapyap.app</span>
        </div>
      </div>
    </div>
  );
}

export function ShareModal({ open, onClose, stats, history, onShowToast }: Props) {
  const [template, setTemplate] = useState<ShareTemplate>('insights');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const weeks = useMemo(() => buildHeatmapWeeks(history, new Date(), 28), [history]);

  if (!open) return null;

  const handleCopyImage = async () => {
    try {
      const canvas = await renderShareCardToCanvas(template, stats, weeks);
      await copyCanvasImage(canvas);
      onShowToast('Image copied to clipboard');
      return true;
    } catch {
      onShowToast('Clipboard image copy unavailable — use Download image.');
      return false;
    }
  };

  const handleDownload = async () => {
    setDropdownOpen(false);
    const canvas = await renderShareCardToCanvas(template, stats, weeks);
    downloadCanvasImage(canvas, `yap-yap-${template}.png`);
    onShowToast('Image downloaded');
  };

  const handleShareOnX = async () => {
    setDropdownOpen(false);
    await handleCopyImage();
    const label = template === 'insights' ? 'insights' : template === 'highlights' ? 'highlights' : 'activity';
    const text = encodeURIComponent(`Here are my Yap Yap ${label}.`);
    window.open(`https://x.com/intent/post?text=${text}`, '_blank');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--bg-modal-backdrop)] backdrop-blur-[1.5px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[940px] h-[660px] max-h-[92vh] rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-2xl flex overflow-hidden relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-7 h-7 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] text-[var(--text-secondary)] flex items-center justify-center"
          aria-label="Close share modal"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Template picker: real miniature cards */}
        <div className="yy-side-surface w-[200px] shrink-0 bg-[var(--bg-modal-sidebar)] p-3 space-y-3 overflow-y-auto">
          {TEMPLATES.map((t) => {
            const active = template === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                className={`w-full px-2.5 pt-2.5 pb-2 rounded-2xl flex flex-col items-center transition-colors ${
                  active ? 'bg-[var(--bg-active-nav)]' : 'hover:bg-[var(--bg-hover)]'
                }`}
              >
                <div
                  className="rounded-[5px] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)] pointer-events-none"
                  style={{ zoom: 0.26 }}
                  aria-hidden="true"
                >
                  <ShareCard template={t.id} stats={stats} weeks={weeks} skeleton />
                </div>
                <div className="text-[14px] text-[var(--text-primary)] mt-1.5">{t.label}</div>
              </button>
            );
          })}
        </div>

        {/* Preview + actions */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-6 overflow-y-auto bg-[var(--bg-main)]">
          <div className="shrink-0 rounded-[20px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 ring-black/5">
            <ShareCard template={template} stats={stats} weeks={weeks} />
          </div>

          <div className="flex items-center gap-2.5 mt-6 relative">
            <button
              type="button"
              onClick={handleCopyImage}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-[14px] font-medium hover:opacity-90 transition-opacity"
            >
              <Copy className="w-4 h-4" />
              <span>Copy image</span>
            </button>

            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 h-11 px-4 rounded-full text-[var(--text-primary)] transition-colors ${
                dropdownOpen ? 'bg-[var(--bg-subtle-hover)]' : 'bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)]'
              }`}
              aria-label="More share options"
              aria-expanded={dropdownOpen}
            >
              <Share className="w-[18px] h-[18px]" />
              <ChevronDown className="w-3 h-3 text-[var(--text-secondary)]" />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setDropdownOpen(false)} />
                <div className="absolute bottom-[54px] left-[calc(100%-260px)] w-[390px] rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-[0_10px_40px_rgba(0,0,0,0.14)] z-30 overflow-hidden">
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="w-full px-5 h-[52px] text-left text-[15px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-3"
                  >
                    <Download className="w-[18px] h-[18px] text-[var(--text-secondary)]" />
                    <span>Download image</span>
                  </button>
                  <div className="h-px bg-[var(--border-subtle)]" />
                  <button
                    type="button"
                    onClick={handleShareOnX}
                    className="w-full px-5 py-3.5 text-left hover:bg-[var(--bg-hover)] flex items-start gap-3"
                  >
                    <span className="w-[18px] h-[18px] rounded-full bg-black text-white flex items-center justify-center shrink-0 mt-[1px]">
                      <XLogo className="w-2.5 h-2.5" />
                    </span>
                    <div>
                      <div className="text-[15px] text-[var(--text-primary)] leading-tight">Share on X</div>
                      <div className="text-[12.5px] text-[var(--text-secondary)] mt-1.5 flex items-center gap-1 flex-wrap">
                        Press <kbd className="yy-keycap !px-1.5 !py-0 text-[11px]">Ctrl</kbd>
                        <kbd className="yy-keycap !px-1.5 !py-0 text-[11px]">V</kbd> to paste the image into your post
                      </div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
