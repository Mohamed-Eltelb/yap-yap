import type { CSSProperties } from 'react';
import { version } from '../../package.json';
import {
  ArrowUpRight,
  Share,
} from 'lucide-react';
import lilacPhoto from '../assets/cards/lilac.webp';
import skyPhoto from '../assets/cards/sky.webp';
import { siteLinks } from '../data/links';
import { ProviderLogo } from './ProviderIcon';
import { PersonalizationIcon } from './SettingsModal';
import {
  InsightsStats,
  formatDurationParts,
  formatWordCount,
} from '../services/stats';
import {
  DictationMode,
  HistoryItem,
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
  onOpenShare: () => void;
  onOpenModal: (tab: SettingsModalTab) => void;
  onStartDictation: (mode: DictationMode) => void;
  onEnablePersonalization: () => void;
}

export function HomeView({
  stats,
  history,
  settings,
  onOpenShare,
  onOpenModal,
  onStartDictation,
  onEnablePersonalization,
}: Props) {
  const wordsFmt = formatWordCount(stats.totalWords);
  const saved = formatDurationParts(stats.timeSavedMinutes);
  const totalTime = formatDurationParts(stats.totalDictationMinutes);

  const dictateKeys = settings.shortcuts.dictate[0] ?? ['Right Alt'];
  const translateKeys = settings.shortcuts.translate[0] ?? [];
  const askKeys = settings.shortcuts.ask[0] ?? [];

  return (
    <div className="yy-home flex-1 h-full overflow-y-auto main-atmosphere flex flex-col justify-between relative">
      {/* Top window controls bar */}
      <div className="sticky top-0 z-20 flex items-center justify-end px-3 pt-2 pb-1 app-drag">
        <WindowControls />
      </div>

      <div className="px-8 pb-8 pt-1 max-w-[1060px] w-full mx-auto">
        <h1 className="yy-page-title text-[34px] font-bold tracking-[-0.025em] text-[var(--text-primary)] mb-5">
          A little yap goes a long way
        </h1>

        <div className="flex flex-col min-[1080px]:flex-row gap-5 items-start">
          {/* Center Insights Column */}
          <div className="yy-home-insights flex-1 min-w-0 w-full space-y-3.5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="yy-page-title text-[20px] font-bold text-[var(--text-primary)]">
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
                <p className="text-[13px] text-[var(--text-secondary)] mt-1">
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
                <p className="text-[13px] text-[var(--text-secondary)] mt-1">
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
                <p className="text-[13px] text-[var(--text-secondary)] mt-1">
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
                <p className="text-[13px] text-[var(--text-secondary)] mt-1">
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
            <div data-personalization-disabled={!settings.personalizationEnabled} className="yy-card px-4 py-4 sm:px-5 sm:py-5 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-[var(--bg-subtle)] p-1.5 text-[var(--text-secondary)]"><PersonalizationIcon className="size-4" /></span>
                  <span className="yy-personalization-score text-[25px] font-bold tracking-tight text-[var(--text-primary)]">
                    {stats.personalizationPercent}%
                  </span>
                </div>
                <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
                  Personalization
                </p>
                <button
                  type="button"
                  onClick={settings.personalizationEnabled ? () => onOpenModal('personalization') : onEnablePersonalization}
                  className="yy-personalization-action mt-4 px-3.5 py-1.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] text-[12px] font-medium text-[var(--text-primary)] transition-colors"
                >
                  {settings.personalizationEnabled ? 'View report' : 'Enable'}
                </button>
              </div>
              <div className="w-[34%] max-w-[210px] shrink-0 self-center">
                {settings.personalizationEnabled ? (
                  <button
                    type="button"
                    aria-label="Open personalization report"
                    onClick={() => onOpenModal('personalization')}
                    className="yy-personalization-chart-button block w-full rounded-full"
                  >
                    <PersonalizationChart sectors={stats.categoryBreakdown} size={210} />
                  </button>
                ) : (
                  <PersonalizationChart sectors={stats.categoryBreakdown} size={210} />
                )}
              </div>
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
                  data-tooltip="Click to start Dictate mode"
                  aria-label="Click to start Dictate mode"
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
                  data-tooltip="Click to start Translate mode"
                  aria-label="Click to start Translate mode"
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
                  data-tooltip="Click to start Ask anything mode"
                  aria-label="Click to start Ask anything mode"
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

            {/* Website cards: they open in the browser. */}
            <a
              href={siteLinks.bestSetups}
              target="_blank"
              rel="noreferrer"
              className="yy-site-card yy-site-card-plain"
            >
              <span className="yy-site-card-title">Best setups</span>
              <ArrowUpRight className="yy-site-card-arrow" aria-hidden="true" />
              <span className="yy-site-card-logos" aria-hidden="true">
                {(['elevenlabs', 'groq', 'gemini', 'openai', 'anthropic'] as const).map((id) => (
                  <span key={id}><ProviderLogo id={id} size={14} /></span>
                ))}
              </span>
            </a>

            <a
              href={siteLinks.setupGuide}
              target="_blank"
              rel="noreferrer"
              className="yy-site-card yy-site-card-photo"
              style={{ '--yy-card-photo': `url(${skyPhoto})` } as CSSProperties}
            >
              <span className="yy-site-card-title">Setup guide</span>
              <ArrowUpRight className="yy-site-card-arrow" aria-hidden="true" />
              <span className="yy-site-card-text">
                Free plans and prices for <strong>every provider</strong>.
              </span>
            </a>

            <a
              href={siteLinks.releaseNotes}
              target="_blank"
              rel="noreferrer"
              className="yy-site-card yy-site-card-photo"
              style={{ '--yy-card-photo': `url(${lilacPhoto})` } as CSSProperties}
            >
              <span className="yy-site-card-title">What’s new</span>
              <ArrowUpRight className="yy-site-card-arrow" aria-hidden="true" />
              <span className="yy-site-card-text">
                See what’s in <strong>v{version}</strong>.
              </span>
            </a>
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
