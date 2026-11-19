import React from 'react';
import {
  BookText,
  HelpCircle,
  History,
  Home,
  KeyRound,
  Mic,
  Monitor,
  Moon,
  Settings,
  TextQuote,
  Sun,
  X,
} from 'lucide-react';
import { ActiveNav, AppearanceMode, DictationMode, ProviderConfig, ProviderId, SettingsModalTab } from '../types/app';
import { PROVIDER_CATALOG, isProviderConfigured } from '../services/providers/catalog';
import { YapLogo } from './YapLogo';

const appearanceModes = {
  light: { label: 'Light', Icon: Sun, next: 'dark' },
  dark: { label: 'Dark', Icon: Moon, next: 'system' },
  system: { label: 'System', Icon: Monitor, next: 'light' },
} as const;

interface Props {
  activeNav: ActiveNav;
  onSelectNav: (nav: ActiveNav) => void;
  onOpenModal: (tab: SettingsModalTab) => void;
  onStartDictation: (mode: DictationMode) => void;
  appearance: AppearanceMode;
  onChangeAppearance: (appearance: AppearanceMode) => void;
  providers: Record<ProviderId, ProviderConfig>;
  activeSttProvider: ProviderId;
  activeLlmProvider: ProviderId | 'none';
  smartCleanup: boolean;
  dismissedQuickCard: boolean;
  onDismissQuickCard: () => void;
  isRecording: boolean;
}

export function Sidebar({
  activeNav,
  onSelectNav,
  onOpenModal,
  onStartDictation,
  appearance,
  onChangeAppearance,
  providers,
  activeSttProvider,
  activeLlmProvider,
  smartCleanup,
  dismissedQuickCard,
  onDismissQuickCard,
  isRecording,
}: Props) {
  const { label, Icon: AppearanceIcon, next } = appearanceModes[appearance];
  const appearanceLabel = `${label} theme. Switch to ${appearanceModes[next].label.toLowerCase()} theme`;
  const navItems: { id: ActiveNav; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'Home', icon: <Home className="w-[16px] h-[16px]" strokeWidth={1.8} /> },
    { id: 'history', label: 'History', icon: <History className="w-[16px] h-[16px]" strokeWidth={1.8} /> },
    { id: 'dictionary', label: 'Dictionary', icon: <BookText className="w-[16px] h-[16px]" strokeWidth={1.8} /> },
    { id: 'snippets', label: 'Snippets', icon: <TextQuote className="w-[16px] h-[16px]" strokeWidth={1.8} /> },
  ];

  const stt = providers[activeSttProvider];
  const llm = smartCleanup && activeLlmProvider !== 'none' ? providers[activeLlmProvider] : undefined;
  const sttReady = isProviderConfigured(stt);
  const llmReady = !llm || isProviderConfigured(llm);
  const failing = [stt, llm].find((p) => p && p.status === 'error');
  const status = !sttReady || !llmReady
    ? { tone: 'bg-amber-500', text: 'Add a key to finish setup' }
    : failing
      ? { tone: 'bg-red-500', text: `${failing.name} key failed`, detail: failing.statusMessage }
      : { tone: 'bg-emerald-500', text: 'Keys ready' };

  return (
    <aside className="yy-side-surface w-[210px] shrink-0 h-full bg-[var(--bg-sidebar)] flex flex-col justify-between select-none">
      {/* Top Brand + Nav */}
      <div>
        <div className="px-4 pt-4 pb-3.5 flex items-center gap-2 app-drag">
          <YapLogo className="w-[19px] h-[19px] text-[var(--text-primary)] shrink-0" />
          <span className="text-[15.5px] font-bold tracking-tight text-[var(--text-primary)]">
            Yap Yap
          </span>
          <span className="text-[10.5px] font-medium px-1.5 py-[1px] rounded-md bg-[var(--bg-active-nav)] text-[var(--text-secondary)]">
            BYOK
          </span>
        </div>

        <nav className="px-2.5 space-y-1">
          {navItems.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectNav(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] text-[13.5px] font-medium transition-colors ${
                  active
                    ? 'bg-[var(--bg-active-nav)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className={active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Cards + Utility Icons */}
      <div className="px-3 pb-3 space-y-2.5">
        {!dismissedQuickCard && (
          <div className="relative group">
            <button
              type="button"
              onClick={() => onStartDictation('dictate')}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-full bg-[var(--bg-card-solid)] shadow-xs text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Mic className={`w-3.5 h-3.5 ${isRecording ? 'text-red-500 animate-pulse' : ''}`} />
              <span>{isRecording ? 'Recording…' : 'Quick dictate'}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismissQuickCard();
              }}
              aria-label="Dismiss quick dictate card"
              className="absolute -top-1.5 -right-1 w-4 h-4 rounded-full bg-zinc-400/80 hover:bg-zinc-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        )}

        {/* Active setup: which models run each dictation, and whether their keys work */}
        <div className="p-3 rounded-[14px] bg-[var(--bg-card-solid)] shadow-xs">
          <SetupRow
            label="Transcribe"
            provider={stt}
            model={modelName(stt, stt.sttModel, 'speech')}
            missing={!sttReady}
          />
          <SetupRow
            label="Clean up"
            provider={llm}
            model={llm ? modelName(llm, llm.llmModel, 'ai') : 'Off'}
            missing={!llmReady}
          />
          <div
            className="flex items-center gap-1.5 mt-2.5 mb-3 text-[11.5px] font-medium text-[var(--text-secondary)]"
            data-tooltip={status.detail}
          >
            <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${status.tone}`} aria-hidden="true" />
            <span className="truncate">{status.text}</span>
          </div>
          <button
            type="button"
            onClick={() => onOpenModal('providers')}
            className="w-full py-2 rounded-full bg-[var(--accent-blue-fill)] hover:bg-[var(--accent-blue-hover)] text-white text-[13px] font-semibold transition-colors shadow-xs"
          >
            API Keys
          </button>
        </div>

        {/* Appearance and utilities */}
        <div className="flex items-center justify-between px-2 pt-1 text-[var(--text-secondary)]">
          <button
            type="button"
            onClick={() => onOpenModal('providers')}
            data-tooltip="Providers & API Keys"
            aria-label="Providers & API Keys"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <KeyRound className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => onChangeAppearance(next)}
            data-tooltip={appearanceLabel}
            aria-label={appearanceLabel}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <AppearanceIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onOpenModal('settings')}
            data-tooltip="Settings"
            aria-label="Settings"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Settings className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => onOpenModal('help')}
            data-tooltip="Help"
            aria-label="Help"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <HelpCircle className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Shows a model by its short name: "Scribe v3", not "Scribe v3 (Latest · Recommended)" or "openai/gpt-oss-20b". */
function modelName(provider: ProviderConfig, modelId: string, kind: 'speech' | 'ai'): string {
  const catalog = PROVIDER_CATALOG[provider.id];
  const known =
    provider.discoveredModels?.[kind].find((m) => m.id === modelId) ??
    (kind === 'speech' ? catalog.sttModels : catalog.llmModels).find((m) => m.id === modelId);
  const label = (known?.label ?? modelId).replace(/\s*\(.*\)\s*$/, '').trim();
  return label.slice(label.lastIndexOf('/') + 1) || modelId;
}

function SetupRow({ label, provider, model, missing }: {
  label: string;
  provider?: ProviderConfig;
  model: string;
  missing: boolean;
}) {
  const value = provider ? `${provider.name} · ${model}` : model;
  return (
    <div className="mt-0.5 first:mt-0 mb-1.5 min-w-0">
      <div className="text-[11px] font-medium text-[var(--text-muted)]">{label}</div>
      <div
        className={`text-[12.5px] font-semibold truncate ${
          missing ? 'text-amber-600 dark:text-amber-400' : provider ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
        }`}
        title={value}
      >
        {missing && provider ? `${provider.name} · Add key` : value}
      </div>
    </div>
  );
}
