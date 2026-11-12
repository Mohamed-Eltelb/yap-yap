import { useMemo, useState } from 'react';
import {
  CloudOff,
  Copy,
  Download,
  Flag,
  Lock,
  Monitor,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { HistoryItem, RetentionPolicy } from '../types/app';
import { WindowControls } from './YapLogo';

interface Props {
  history: HistoryItem[];
  retention: RetentionPolicy;
  cloudSyncMock: boolean;
  onChangeRetention: (policy: RetentionPolicy) => void;
  onToggleCloudSync: () => void;
  onCopyText: (text: string) => void;
  onToggleFlag: (id: string) => void;
  onRetryItem: (item: HistoryItem) => void;
  onDownloadAudio: (item: HistoryItem) => void;
  onDeleteItem: (id: string) => void;
  onClearSamples: () => void;
  onClearAll: () => void;
  onExportJson: () => void;
}

type HistoryFilter = 'all' | 'dictations' | 'ask';

function formatDayHeading(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) return 'Today';

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryView({
  history,
  retention,
  cloudSyncMock,
  onChangeRetention,
  onToggleCloudSync,
  onCopyText,
  onToggleFlag,
  onRetryItem,
  onDownloadAudio,
  onDeleteItem,
  onClearSamples,
  onClearAll,
  onExportJson,
}: Props) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const filtered = useMemo(() => {
    if (filter === 'dictations') {
      return history.filter((h) => h.mode === 'dictate' || h.mode === 'translate');
    }
    if (filter === 'ask') {
      return history.filter((h) => h.mode === 'ask');
    }
    return history;
  }, [history, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, HistoryItem[]>();
    for (const item of filtered) {
      const heading = formatDayHeading(item.createdAt);
      const list = map.get(heading) ?? [];
      list.push(item);
      map.set(heading, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const hasSamples = history.some((h) => h.isSample);

  return (
    <div
      className="flex-1 h-full overflow-y-auto bg-[var(--bg-main)] flex flex-col"
      onClick={() => {
        if (openMenuId) setOpenMenuId(null);
        if (headerMenuOpen) setHeaderMenuOpen(false);
      }}
    >
      {/* Top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-end px-3 pt-2 pb-1 bg-[var(--bg-main)]/85 backdrop-blur-sm app-drag">
        <WindowControls />
      </div>

      <div className="px-10 pb-10 pt-1 max-w-[960px] w-full mx-auto">
        {/* Title + Top-right Controls */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[28px] font-bold tracking-tight text-[var(--text-primary)]">
            History
          </h1>

          <div className="flex items-center gap-3 relative">
            <button
              type="button"
              onClick={onToggleCloudSync}
              className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="Local-first mode keeps everything on this device"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span>Cloud Sync</span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  cloudSyncMock
                    ? 'bg-[var(--accent-blue)] text-white border-transparent'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                }`}
              >
                {cloudSyncMock ? 'On' : 'Off'}
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setHeaderMenuOpen((v) => !v);
              }}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="History options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {headerMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-9 z-40 w-48 rounded-xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-xl py-1.5 text-[13px]"
              >
                <button
                  type="button"
                  onClick={() => {
                    onExportJson();
                    setHeaderMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export history JSON</span>
                </button>
                {hasSamples && (
                  <button
                    type="button"
                    onClick={() => {
                      onClearSamples();
                      setHeaderMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear sample data</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onClearAll();
                    setHeaderMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-red-500 hover:bg-[var(--bg-hover)] flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear all history</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Keep history + Privacy Card */}
        <div className="rounded-2xl bg-[var(--bg-subtle)]/75 border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] mb-6">
          <div className="px-5 py-3.5 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
                <Monitor className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>Keep history</span>
              </div>
              <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                Choose how long to keep your history on this device.
              </p>
            </div>
            <select
              value={retention}
              onChange={(e) => onChangeRetention(e.target.value as RetentionPolicy)}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12.5px] font-medium text-[var(--text-primary)] focus:outline-none"
            >
              <option value="forever">Forever</option>
              <option value="90d">90 days</option>
              <option value="30d">30 days</option>
              <option value="7d">7 days</option>
            </select>
          </div>

          <div className="px-5 py-3.5">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
              <Lock className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span>Your data stays private</span>
            </div>
            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
              Your voice dictations are private with zero data retention. They are stored only on your device and send directly using your own API keys.
            </p>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="inline-flex items-center p-1 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] mb-6">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'dictations', label: 'Dictations' },
              { id: 'ask', label: 'Ask anything' },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3.5 py-1 rounded-full text-[12.5px] font-medium transition-colors ${
                  active
                    ? 'bg-[var(--bg-card-solid)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Chronological Grouped List */}
        {groups.length === 0 ? (
          <div className="yy-card p-10 text-center text-[13.5px] text-[var(--text-secondary)]">
            No history entries yet. Press your Dictate shortcut or click Quick dictate in the sidebar to record your first transcript.
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(([heading, items]) => (
              <div key={heading}>
                <h3 className="text-[11.5px] font-medium text-[var(--text-secondary)] mb-2 px-1">
                  {heading}
                </h3>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] divide-y divide-[var(--border-subtle)]">
                  {items.map((item) => {
                    const isMenuOpen = openMenuId === item.id;
                    return (
                      <div
                        key={item.id}
                        className="group relative px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[var(--bg-hover)]/45 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                      >
                        <div className="flex items-start gap-4 min-w-0 flex-1">
                          <span className="text-[11.5px] text-[var(--text-muted)] w-[60px] shrink-0 pt-0.5 tabular-nums">
                            {formatTime(item.createdAt)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              dir="auto"
                              className="text-[13.5px] text-[var(--text-primary)] leading-relaxed selectable break-words"
                            >
                              {item.text}
                            </p>
                            {item.mode === 'ask' && item.rawText !== item.text && (
                              <p
                                dir="auto"
                                className="text-[11.5px] text-[var(--text-muted)] mt-1 truncate"
                              >
                                Prompt: {item.rawText}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Hover Actions matching Image 4 */}
                        <div
                          className={`flex items-center gap-1 shrink-0 transition-opacity ${
                            isMenuOpen || item.flagged
                              ? 'opacity-100'
                              : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onCopyText(item.text)}
                            title="Copy transcript"
                            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-active-nav)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleFlag(item.id)}
                            title={item.flagged ? 'Remove flag' : 'Flag transcript'}
                            className={`p-1.5 rounded-lg hover:bg-[var(--bg-active-nav)] transition-colors ${
                              item.flagged
                                ? 'text-[var(--accent-blue)]'
                                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            <Flag className="w-3.5 h-3.5" />
                          </button>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(isMenuOpen ? null : item.id);
                              }}
                              title="More actions"
                              className={`p-1.5 rounded-lg transition-colors ${
                                isMenuOpen
                                  ? 'bg-[var(--bg-active-nav)] text-[var(--text-primary)]'
                                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-active-nav)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>

                            {isMenuOpen && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-9 z-40 w-44 rounded-xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-2xl py-1.5 text-[13px]"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    onRetryItem(item);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full px-3.5 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2.5"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                                  <span>Retry</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDownloadAudio(item);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full px-3.5 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2.5"
                                >
                                  <Download className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                                  <span>Download audio</span>
                                </button>
                                <div className="my-1 border-t border-[var(--border-subtle)]" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteItem(item.id);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full px-3.5 py-2 text-left text-red-500 hover:bg-[var(--bg-hover)] flex items-center gap-2.5"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete transcript</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
