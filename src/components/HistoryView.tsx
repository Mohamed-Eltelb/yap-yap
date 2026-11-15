import { SelectMenu } from './SelectMenu';
import { AnswerMarkdown } from './AnswerMarkdown';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Flag,
  HardDrive,
  Info,
  Lock,
  Mic,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { HistoryItem, RetentionPolicy } from '../types/app';
import { WindowControls, YapLogo } from './YapLogo';

interface Props {
  history: HistoryItem[];
  retention: RetentionPolicy;
  onChangeRetention: (policy: RetentionPolicy) => void;
  onCopyText: (text: string) => void;
  onToggleFlag: (id: string) => void;
  onEditItem: (id: string, newText: string) => void;
  onRetryItem: (item: HistoryItem) => void;
  onDownloadAudio: (item: HistoryItem) => void;
  onDeleteItem: (id: string) => void;
  onClearAll: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
}

type HistoryFilter = 'all' | 'dictations' | 'ask';

const retentionOptions = [
  { value: 'forever', label: 'Forever' },
  { value: '1y', label: '1 year' },
  { value: '30d', label: '1 month' },
  { value: '7d', label: '1 week' },
  { value: '24h', label: '24 hours' },
  { value: 'never', label: 'Never' },
] satisfies { value: RetentionPolicy; label: string }[];

function getHistoryAnswer(item: HistoryItem): string | undefined {
  if (item.mode !== 'ask') return undefined;
  const transcript = item.text.trim();
  const prompt = item.rawText.trim();
  return item.answer?.trim() || (prompt && prompt !== transcript ? transcript : undefined);
}

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
  onChangeRetention,
  onCopyText,
  onToggleFlag,
  onEditItem,
  onRetryItem,
  onDownloadAudio,
  onDeleteItem,
  onClearAll,
  onExportJson,
  onImportJson,
}: Props) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [answerItemId, setAnswerItemId] = useState<string | null>(null);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const answerDialog = useRef<HTMLDialogElement>(null);
  const answerItem = history.find((item) => item.id === answerItemId);
  const answer = answerItem && getHistoryAnswer(answerItem);
  const question = answerItem?.rawText.trim();

  useEffect(() => {
    const dialog = answerDialog.current;
    if (answer && dialog && !dialog.open) dialog.showModal();
    else if (!answer && dialog?.open) dialog.close();
  }, [answer]);

  useEffect(() => () => audioPlayerRef.current?.pause(), []);
  useEffect(() => {
    if (playingId && !history.some((item) => item.id === playingId)) {
      audioPlayerRef.current?.pause();
      setPlayingId(null);
    }
  }, [history, playingId]);

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

  const handleTogglePlay = (item: HistoryItem) => {
    if (!item.audioDataUrl) return;
    if (playingId === item.id && audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setPlayingId(null);
      return;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }
    const audio = new Audio(item.audioDataUrl);
    audioPlayerRef.current = audio;
    setPlayingId(item.id);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    void audio.play().catch(() => setPlayingId(null));
  };

  const handleSaveEdit = (id: string) => {
    const trimmed = editDraft.trim();
    if (trimmed) {
      onEditItem(id, trimmed);
    }
    setEditingId(null);
    setEditDraft('');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImportJson(file);
    e.target.value = '';
  };

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

      <div className="yy-history mx-auto w-full max-w-[1400px] px-5 pb-10 pt-1 sm:px-7">
        {/* Title + Top-right Controls */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="yy-page-title text-[clamp(28px,4vw,36px)] font-bold tracking-tight text-[var(--text-primary)]">
            History
          </h1>

          <div className="flex items-center gap-3 relative">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />

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
                className="absolute right-0 top-9 z-40 w-52 overflow-hidden rounded-xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-xl text-[13px]"
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
                  <span>Export local history</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setHeaderMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import history JSON</span>
                </button>
                {history.length > 0 && (
                  <>
                    <div className="border-t border-[var(--border-subtle)]" />
                    <button
                      type="button"
                      onClick={() => {
                        clearDialog.current?.showModal();
                        setHeaderMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left text-red-600 dark:text-red-400 hover:bg-[var(--bg-hover)] flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear all history</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Keep history + Privacy Card */}
        <div className="yy-history-policy rounded-xl px-3.5 divide-y divide-[var(--border-subtle)] mb-4">
          <div className="py-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                <HardDrive className="size-3.5" />
                <span>Keep history</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mt-1.5">
                Choose how long to keep your history on this device.
              </p>
            </div>
            <SelectMenu<RetentionPolicy>
              label="Keep history"
              value={retention}
              className="yy-history-retention w-40 shrink-0"
              showCheckmark={false}
              options={retention === '90d'
                ? [...retentionOptions.slice(0, 2), { value: '90d', label: '90 days' }, ...retentionOptions.slice(2)]
                : retentionOptions}
              onChange={onChangeRetention}
            />
          </div>

          <div className="py-3.5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
              <Lock className="size-3.5" />
              <span>Your data stays private</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mt-1.5">
              Yap Yap stores history and recordings on this device. If you use a cloud provider, it receives the audio or text needed to process your request. The provider’s retention policy applies.
            </p>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="yy-history-filters inline-flex items-center p-1 rounded-full mb-7" aria-label="Filter history">
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
                aria-pressed={active}
                onClick={() => setFilter(tab.id)}
                className="px-3 py-1.5 rounded-full text-[13px] transition-colors"
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
                <h3 className="text-xs text-[var(--text-secondary)] mb-3">
                  {heading}
                </h3>
                <div className="rounded-xl border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {items.map((item) => {
                    const isMenuOpen = openMenuId === item.id;
                    const isEditing = editingId === item.id;
                    const isPlaying = playingId === item.id;
                    const hasAnswer = Boolean(getHistoryAnswer(item));
                    const needsRetry = !hasAnswer && !item.text.trim() && Boolean(item.audioDataUrl || item.outcome);
                    const emptyNote = item.outcome === 'silent'
                      ? ['Audio is silent.', "Yap Yap didn't detect any words in this dictation, so the transcript is empty."]
                      : item.outcome === 'cancelled'
                        ? ['The transcription was cancelled.', 'You cancelled this transcription. To recover it, click Retry.']
                        : ['No transcription available.', 'This recording has no transcript yet. Click Retry to transcribe it.'];
                    const keepActionsVisible = needsRetry || isMenuOpen || isPlaying || (!hasAnswer && item.flagged);

                    return (
                      <div
                        key={item.id}
                        className="group relative min-h-12 px-3 py-2 flex items-center justify-between gap-3 hover:bg-[var(--bg-hover)]/30 transition-colors first:rounded-t-xl last:rounded-b-xl"
                      >
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <span className="text-xs text-[var(--text-muted)] w-[60px] shrink-0 pt-0.5 tabular-nums">
                            {formatTime(item.createdAt)}
                          </span>
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  dir="auto"
                                  autoFocus
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveEdit(item.id);
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  className="flex-1 px-3 py-1 rounded-lg bg-[var(--bg-input)] border border-[var(--accent-blue)] text-[13.5px] text-[var(--text-primary)] focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(item.id)}
                                  className="p-1.5 rounded-lg bg-[var(--accent-blue-fill)] text-white"
                                  aria-label="Save transcript"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="p-1.5 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                                  aria-label="Cancel"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <>
                                {needsRetry ? (
                                  <p className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
                                    {emptyNote[0]}
                                    <span className="group/tip relative inline-flex">
                                      <button type="button" aria-label="Why is this transcript empty?" aria-describedby={`empty-${item.id}`} className="rounded-full hover:text-[var(--text-primary)]">
                                        <Info aria-hidden="true" className="size-3.5 shrink-0" />
                                      </button>
                                      <span id={`empty-${item.id}`} role="tooltip" className="yy-personalization-tooltip pointer-events-none invisible absolute bottom-full left-0 z-20 mb-1.5 w-64 rounded-lg p-2.5 text-xs leading-relaxed shadow-lg group-hover/tip:visible group-focus-within/tip:visible">
                                        {emptyNote[1]}
                                      </span>
                                    </span>
                                  </p>
                                ) : <p
                                  dir="auto"
                                  className="text-sm text-[var(--text-primary)] leading-relaxed break-words"
                                >
                                  {hasAnswer ? item.rawText.trim() || 'Ask anything' : item.text}
                                </p>}
                              </>
                            )}
                          </div>
                        </div>

                        {hasAnswer && !keepActionsVisible && (
                          <Sparkles aria-hidden="true" className="yy-history-answer-spark pointer-events-none absolute right-5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-muted)] opacity-50 group-hover:opacity-0 group-focus-within:opacity-0" />
                        )}
                        <div
                          className={`flex items-center gap-1 shrink-0 transition-opacity ${hasAnswer ? 'yy-history-answer-actions' : ''} ${
                            keepActionsVisible
                              ? 'opacity-100'
                              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                          }`}
                        >
                          {hasAnswer && (
                            <button type="button" onClick={() => setAnswerItemId(item.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--bg-hover)] px-2.5 py-1.5 text-sm hover:bg-[var(--bg-subtle)]">
                              <Sparkles aria-hidden="true" className="size-3.5" />
                              <span>View answer</span>
                            </button>
                          )}
                          {needsRetry && item.audioDataUrl && (
                            <button type="button" onClick={() => onRetryItem(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--bg-subtle)] px-2.5 py-1.5 text-sm hover:bg-[var(--bg-subtle-hover)]">
                              <RotateCcw className="size-3.5" />
                              Retry
                            </button>
                          )}
                          {item.audioDataUrl && !needsRetry && !hasAnswer && (
                            <button
                              type="button"
                              onClick={() => handleTogglePlay(item)}
                              aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-active-nav)] hover:text-[var(--text-primary)] transition-colors"
                            >
                              {isPlaying ? (
                                <Pause className="w-3.5 h-3.5 text-[var(--accent-blue)]" />
                              ) : (
                                <Play className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                          {!needsRetry && !hasAnswer && <button
                            type="button"
                            onClick={() => onCopyText(item.text)}
                            data-tooltip="Copy transcript"
                            aria-label="Copy transcript"
                            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-active-nav)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>}
                          <button
                            type="button"
                            onClick={() => onToggleFlag(item.id)}
                            data-tooltip={item.flagged ? 'Remove flag' : 'Flag transcript'}
                            aria-label={item.flagged ? 'Remove flag' : 'Flag transcript'}
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
                              aria-label="More actions"
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
                                className="absolute right-0 top-9 z-40 w-44 overflow-hidden rounded-xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-2xl text-[13px]"
                              >
                                {hasAnswer && item.audioDataUrl && (
                                  <button
                                    type="button"
                                    onClick={() => { handleTogglePlay(item); setOpenMenuId(null); }}
                                    className="w-full px-3.5 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2.5"
                                  >
                                    {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                                    {isPlaying ? 'Pause audio' : 'Play audio'}
                                  </button>
                                )}
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
                                    setEditingId(item.id);
                                    setEditDraft(getHistoryAnswer(item) ?? item.text);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full px-3.5 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2.5"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                                  <span>{hasAnswer ? 'Edit answer' : 'Edit transcript'}</span>
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
                                <div className="border-t border-[var(--border-subtle)]" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteItem(item.id);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full px-3.5 py-2 text-left text-red-600 dark:text-red-400 hover:bg-[var(--bg-hover)] flex items-center gap-2.5"
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
      <dialog
        ref={answerDialog}
        aria-labelledby="history-answer-title"
        onClose={() => setAnswerItemId(null)}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
        className="yy-history-answer-dialog m-auto w-[760px] max-w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] rounded-2xl border border-[var(--border-subtle)] text-[var(--text-primary)] shadow-2xl backdrop:bg-black/55"
      >
        <div className="p-4">
          <header className="relative flex items-center justify-center pb-3">
            <h2 id="history-answer-title" className="flex items-center gap-1.5 font-bold"><YapLogo className="size-4" /> Yap Yap</h2>
            <button type="button" aria-label="Close answer" autoFocus onClick={() => answerDialog.current?.close()} className="absolute right-0 top-0 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><X size={15} /></button>
          </header>
          {question && (
            <div className="flex items-start gap-2 px-3 py-2.5 text-sm text-[var(--text-secondary)]">
              <Mic aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <p dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{question}</p>
              <button type="button" aria-label="Copy question" onClick={() => onCopyText(question)} className="shrink-0 rounded-md p-1 hover:bg-[var(--bg-hover)]"><Copy size={14} /></button>
            </div>
          )}
          <section className="mt-2 min-h-[min(300px,45dvh)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)]">
            <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
              <Sparkles aria-hidden="true" className="size-4" />
              <h3 className="flex-1 font-semibold">Answer</h3>
              {answer && <button type="button" aria-label="Copy answer" onClick={() => onCopyText(answer)} className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Copy size={14} /></button>}
            </header>
            <AnswerMarkdown text={answer ?? undefined} className="px-4 py-3 text-sm leading-relaxed select-text" />
          </section>
        </div>
      </dialog>
      <dialog
        ref={clearDialog}
        aria-labelledby="clear-history-title"
        className="m-auto w-[420px] max-w-[calc(100%-2rem)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-modal)] p-6 text-[var(--text-primary)] shadow-2xl backdrop:bg-black/45"
      >
        <h2 id="clear-history-title" className="text-lg font-semibold">Clear all history?</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          This permanently deletes all transcripts and recordings saved in Yap Yap.
        </p>
        <form method="dialog" className="mt-5 flex justify-end gap-2">
          <button autoFocus className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm">Cancel</button>
          <button onClick={onClearAll} className="rounded-full bg-red-700 px-4 py-2 text-sm font-medium text-white">
            Clear history
          </button>
        </form>
      </dialog>
    </div>
  );
}
