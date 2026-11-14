import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HeatmapCell, buildHeatmapWeeks } from '../services/stats';
import { HistoryItem } from '../types/app';

interface Props {
  history: HistoryItem[];
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function ActivityHeatmap({
  history,
  activeDays,
  currentStreak,
  longestStreak,
}: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [hovered, setHovered] = useState<{
    cell: HeatmapCell;
    x: number;
    y: number;
  } | null>(null);

  const anchorDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - weekOffset * 28);
    return d;
  }, [weekOffset]);

  const weeks = useMemo(
    () => buildHeatmapWeeks(history, anchorDate, 28),
    [history, anchorDate]
  );

  const getCellStyle = (cell: HeatmapCell): React.CSSProperties => {
    if (cell.hatched) return {};
    const map: Record<number, string> = {
      0: 'var(--heatmap-0)',
      1: 'var(--heatmap-1)',
      2: 'var(--heatmap-2)',
      3: 'var(--heatmap-3)',
      4: 'var(--heatmap-4)',
    };
    return { backgroundColor: map[cell.level] };
  };

  return (
    <div className="yy-card p-5 relative">
      {/* Top counters row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold tracking-tight text-[var(--text-primary)]">
              {activeDays}
            </span>
            <span className="text-[12.5px] font-medium text-[var(--text-primary)]">
              days
            </span>
          </div>
          <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
            Active days
          </p>
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold tracking-tight text-[var(--text-primary)]">
              {currentStreak}
            </span>
            <span className="text-[12.5px] font-medium text-[var(--text-primary)]">
              days
            </span>
          </div>
          <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
            Current streak
          </p>
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold tracking-tight text-[var(--text-primary)]">
              {longestStreak}
            </span>
            <span className="text-[12.5px] font-medium text-[var(--text-primary)]">
              days
            </span>
          </div>
          <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
            Longest streak
          </p>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="relative">
        <div className="flex items-start gap-2">
          <div className="flex flex-col justify-between gap-[5px] pt-[1px] pr-1">
            {DAY_LABELS.map((d, i) => (
              <span
                key={i}
                className="h-[13px] leading-[13px] text-[9.5px] text-[var(--text-muted)] font-medium text-center w-3"
              >
                {d}
              </span>
            ))}
          </div>

          <div className="flex-1 overflow-x-auto pb-1">
            <div className="grid grid-flow-col auto-cols-fr gap-[4.5px] min-w-[490px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[5px]">
                  {week.days.map((cell) => (
                    <button
                      key={cell.dateKey}
                      type="button"
                      aria-label={`${cell.label}: ${cell.usageLabel}`}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const parentRect =
                          e.currentTarget
                            .closest('.yy-card')
                            ?.getBoundingClientRect() ?? rect;
                        setHovered({
                          cell,
                          x: rect.left - parentRect.left + rect.width / 2,
                          y: rect.top - parentRect.top,
                        });
                      }}
                      onMouseLeave={() => setHovered(null)}
                      style={getCellStyle(cell)}
                      className={`w-[13px] h-[13px] rounded-[3.5px] transition-transform duration-100 hover:scale-125 focus:outline-none ${
                        cell.hatched ? 'yy-hatched' : ''
                      }`}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Month Labels + Pagination Arrows */}
            <div className="flex items-center justify-between mt-2.5 min-w-[490px]">
              <button
                type="button"
                onClick={() => setWeekOffset((v) => v + 1)}
                aria-label="Earlier months"
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <div className="flex-1 grid grid-flow-col auto-cols-fr gap-[4.5px] px-1">
                {weeks.map((week, wi) => (
                  <span
                    key={wi}
                    className="text-[10px] text-[var(--text-muted)] font-medium whitespace-nowrap"
                  >
                    {week.monthLabel ?? ''}
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setWeekOffset((v) => Math.max(0, v - 1))}
                disabled={weekOffset === 0}
                aria-label="Later months"
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-3 text-[11px] text-[var(--text-secondary)]">
          <span className="mr-0.5">Less</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span
              key={lvl}
              style={{ backgroundColor: `var(--heatmap-${lvl})` }}
              className="w-[11px] h-[11px] rounded-[3px] inline-block"
            />
          ))}
          <span className="ml-0.5">More</span>
        </div>
      </div>

      {/* Black Floating Tooltip matching Image 2 */}
      {hovered && (
        <div
          style={{
            left: hovered.x,
            top: hovered.y - 10,
            transform: 'translate(-50%, -100%)',
          }}
          className="pointer-events-none absolute z-30 bg-[#141416] text-white rounded-xl px-3.5 py-2.5 shadow-xl min-w-[140px] border border-white/10"
        >
          <div className="text-[12px] text-zinc-400 font-medium leading-snug">
            {hovered.cell.label}
          </div>
          <div className="text-[12.5px] text-white font-semibold mt-1 leading-snug">
            {hovered.cell.usageLabel}
          </div>
          <div className="w-2.5 h-2.5 bg-[#141416] rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-1 border-r border-b border-white/10" />
        </div>
      )}
    </div>
  );
}
