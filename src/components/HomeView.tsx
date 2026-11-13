import { version } from '../../package.json';
import {
  CheckCircle2,
  Cpu,
  KeyRound,
  Mic,
  Share,
  UserCheck,
  X,
} from 'lucide-react';
import {
  InsightsStats,
  formatDurationParts,
  formatWordCount,
} from '../services/stats';
import { PROVIDER_CATALOG } from '../services/providers/catalog';
import {
  DictationMode,
  HistoryItem,
  ProviderConfig,
  ProviderId,
  SettingsModalTab,
  SettingsState,
} from '../types/app';
import { ActivityHeatmap } from './ActivityHeatmap';
import { PersonalizationChart } from './PersonalizationChart';
import { WindowControls } from './YapLogo';

interface Props {
  stats: InsightsStats;
  history: HistoryItem[];
  settings: SettingsState;
  providers: Record<ProviderId, ProviderConfig>;
  onOpenShare: () => void;
  onOpenModal: (tab: SettingsModalTab) => void;
  onStartDictation: (mode: DictationMode) => void;
  onDismissPromoCard: () => void;
}

export function HomeView({
  stats,
  history,
  settings,
  providers,
  onOpenShare,
  onOpenModal,
  onStartDictation,
  onDismissPromoCard,
}: Props) {
  const wordsFmt = formatWordCount(stats.totalWords);
  const saved = formatDurationParts(stats.timeSavedMinutes);
  const totalTime = formatDurationParts(stats.totalDictationMinutes);

  const activeStt = providers[settings.activeSttProvider];
  const sttReady =
    activeStt.apiKey.trim().length > 0 ||
    !PROVIDER_CATALOG[settings.activeSttProvider].requiresKey;

  const dictateKeys = settings.shortcuts.dictate[0] ?? ['Right Alt'];
  const translateKeys = settings.shortcuts.translate[0] ?? [];
  const askKeys = settings.shortcuts.ask[0] ?? [];

  return (
    <div className="flex-1 h-full overflow-y-auto main-atmosphere flex flex-col justify-between relative">
      {/* Top window controls bar */}
      <div className="sticky top-0 z-20 flex items-center justify-end px-3 pt-2 pb-1 app-drag">
        <WindowControls />
      </div>

      <div className="px-8 pb-8 pt-1 max-w-[1060px] w-full mx-auto">
        <h1 className="text-[34px] font-bold tracking-[-0.025em] text-[var(--text-primary)] mb-5">
          Speak, don&apos;t type
        </h1>

        <div className="flex flex-col min-[1080px]:flex-row gap-5 items-start">
          {/* Center Insights Column */}
          <div className="flex-1 min-w-0 w-full space-y-3.5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[19px] font-semibold text-[var(--text-primary)]">
                Insights
              </h2>
              <button
                type="button"
                onClick={onOpenShare}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] shadow-xs text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Share className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>
            </div>

            {/* 2x2 Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="yy-card px-5 py-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[24px] font-bold tracking-tight text-[var(--text-primary)]">
                    {wordsFmt.value}
                  </span>
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    {wordsFmt.unit}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                  Words dictated
                </p>
              </div>

              <div className="yy-card px-5 py-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-[24px] font-bold tracking-tight text-[var(--text-primary)]">
                    {saved.firstVal}
                  </span>
                  <span className="text-[13px] font-medium text-[var(--text-primary)] mr-1">
                    {saved.firstUnit}
                  </span>
                  <span className="text-[24px] font-bold tracking-tight text-[var(--text-primary)]">
                    {saved.secondVal}
                  </span>
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    {saved.secondUnit}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                  Time saved
                </p>
              </div>

              <div className="yy-card px-5 py-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[24px] font-bold tracking-tight text-[var(--text-primary)]">
                    {stats.averageWpm}
                  </span>
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    WPM
                  </span>
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                  Average dictation speed
                </p>
              </div>

              <div className="yy-card px-5 py-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-[24px] font-bold tracking-tight text-[var(--text-primary)]">
                    {totalTime.firstVal}
                  </span>
                  <span className="text-[13px] font-medium text-[var(--text-primary)] mr-1">
                    {totalTime.firstUnit}
                  </span>
                  <span className="text-[24px] font-bold tracking-tight text-[var(--text-primary)]">
                    {totalTime.secondVal}
                  </span>
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    {totalTime.secondUnit}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                  Total dictation time
                </p>
              </div>
            </div>

            {/* Heatmap Card */}
            <ActivityHeatmap
              history={history}
              activeDays={stats.activeDays}
              currentStreak={stats.currentStreak}
              longestStreak={stats.longestStreak}
            />

            {/* Personalization Card */}
            <div className="yy-card yy-personalization-summary px-4 py-4 sm:px-5 sm:py-5 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-[var(--bg-subtle)] p-1.5 text-[var(--text-secondary)]"><UserCheck className="size-4" /></span>
                  <span className="text-[25px] font-bold tracking-tight text-[var(--text-primary)]">
                    {settings.personalizationEnabled ? `${stats.personalizationPercent}%` : 'Off'}
                  </span>
                </div>
                <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
                  Personalization
                </p>
                <button
                  type="button"
                  onClick={() => onOpenModal('personalization')}
                  className="mt-4 px-3.5 py-1.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] text-[12px] font-medium text-[var(--text-primary)] transition-colors"
                >
                  View report
                </button>
              </div>
              <button type="button" aria-label="Open personalization settings" onClick={() => onOpenModal('personalization')} className="yy-personalization-chart-button w-[34%] max-w-[210px] shrink-0 self-center rounded-full">
                <PersonalizationChart sectors={stats.categoryBreakdown} size={210} />
              </button>
            </div>
          </div>

          {/* Right Rail matching Images 1 & 13 */}
          <div className="yy-home-rail w-full min-[1080px]:w-[188px] shrink-0 space-y-3 pt-1">
            {/* Shortcuts Cheatsheet Card */}
            <div className="yy-card p-3.5 space-y-3">
              <div>
                <div className="text-[11.5px] text-[var(--text-secondary)] mb-1.5">
                  Dictate
                </div>
                <button
                  type="button"
                  onClick={() => onStartDictation('dictate')}
                  className="flex flex-wrap gap-1 hover:opacity-80 transition-opacity"
                  title="Click to start Dictate mode"
                >
                  {dictateKeys.map((k, i) => (
                    <span key={i} className="yy-keycap">
                      {k}
                    </span>
                  ))}
                </button>
              </div>

              <div>
                <div className="text-[11.5px] text-[var(--text-secondary)] mb-1.5">
                  Translate
                </div>
                <button
                  type="button"
                  onClick={() => onStartDictation('translate')}
                  className="flex flex-wrap gap-1 hover:opacity-80 transition-opacity text-left"
                  title="Click to start Translate mode"
                >
                  {translateKeys.length === 0 && <span className="yy-keycap">Start</span>}
                  {translateKeys.map((k, i) => (
                    <span key={i} className="yy-keycap">
                      {k}
                    </span>
                  ))}
                </button>
              </div>

              <div>
                <div className="text-[11.5px] text-[var(--text-secondary)] mb-1.5">
                  Ask anything
                </div>
                <button
                  type="button"
                  onClick={() => onStartDictation('ask')}
                  className="flex flex-wrap gap-1 hover:opacity-80 transition-opacity text-left"
                  title="Click to start Ask anything mode"
                >
                  {askKeys.length === 0 && <span className="yy-keycap">Start</span>}
                  {askKeys.map((k, i) => (
                    <span key={i} className="yy-keycap">
                      {k}
                    </span>
                  ))}
                </button>
              </div>
            </div>

            {/* Popular use cases pill card */}
            <button
              type="button"
              onClick={() => onOpenModal('personalization')}
              className="w-full yy-card p-3 text-left hover:bg-[var(--bg-hover)] transition-colors"
            >
              <div className="text-[12px] font-medium text-[var(--text-primary)] mb-2">
                Popular use cases
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                  AI
                </span>
                <span className="w-5 h-5 rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center text-[10px] font-bold">
                  💬
                </span>
                <span className="w-5 h-5 rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center text-[10px] font-bold">
                  &lt;/&gt;
                </span>
                <span className="w-5 h-5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold">
                  ✉
                </span>
              </div>
            </button>

            {/* Active Provider Card (matching the featured card slot) */}
            {!settings.dismissedPromoCard && (
              <div className="yy-card p-3.5 relative group">
                <button
                  type="button"
                  onClick={onDismissPromoCard}
                  aria-label="Close provider card"
                  className="absolute top-2 right-2 w-4 h-4 rounded-full bg-zinc-400/70 hover:bg-zinc-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
                <div className="w-10 h-10 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] flex items-center justify-center mb-2.5">
                  <Cpu className="w-5 h-5 text-[var(--text-primary)]" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                    {activeStt.name}
                  </span>
                  {sttReady && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                  {sttReady
                    ? `Active model: ${activeStt.sttModel || 'Configured'}`
                    : 'Add your API key to enable voice capture.'}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    sttReady
                      ? onStartDictation('dictate')
                      : onOpenModal('providers')
                  }
                  className="w-full mt-3 py-2 rounded-full bg-[var(--btn-dark-bg)] text-[var(--btn-dark-text)] text-[12px] font-semibold hover:opacity-90 transition-opacity"
                >
                  {sttReady ? 'Start dictating' : 'Add API key'}
                </button>
              </div>
            )}

            {/* Two compact accent cards matching bottom right */}
            <button
              type="button"
              onClick={() => onStartDictation('translate')}
              className="w-full yy-card p-3.5 text-left hover:bg-[var(--bg-hover)] transition-colors relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-sky-400/10 via-transparent to-blue-500/10 pointer-events-none" />
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
                <Mic className="w-3.5 h-3.5 text-[var(--accent-blue)]" />
                <span>Live Translate</span>
              </div>
              <p className="text-[11.5px] text-[var(--text-secondary)] mt-1 leading-snug">
                Speak in any language &amp; paste into{' '}
                <strong className="text-[var(--text-primary)] font-semibold">
                  {settings.translationTargets[0] ?? 'English'}
                </strong>
                .
              </p>
            </button>

            <button
              type="button"
              onClick={() => onOpenModal('providers')}
              className="w-full yy-card p-3.5 text-left hover:bg-[var(--bg-hover)] transition-colors relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-400/10 via-transparent to-purple-500/10 pointer-events-none" />
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
                <KeyRound className="w-3.5 h-3.5 text-[var(--accent-blue)]" />
                <span>Multi-provider</span>
              </div>
              <p className="text-[11.5px] text-[var(--text-secondary)] mt-1 leading-snug">
                Supports <strong className="text-[var(--text-primary)] font-semibold">7 APIs</strong>: OpenAI, Groq, Gemini, Claude &amp; local.
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom right version footer */}
      <div className="px-6 pb-3 flex justify-end">
        <div className="text-right text-[11px] text-[var(--text-muted)] leading-relaxed">
          <button
            type="button"
            onClick={() => onOpenModal('about')}
            className="underline hover:text-[var(--text-secondary)] transition-colors"
          >
            Version v{version}
          </button>
        </div>
      </div>
    </div>
  );
}
