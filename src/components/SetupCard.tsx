import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronsUpDown, KeyRound, Plus } from 'lucide-react';
import type { CleanupLevel, ProviderConfig, ProviderId, ProviderModel, SettingsState } from '../types/app';
import { PROVIDER_CATALOG, PROVIDER_ORDER, isProviderConfigured } from '../services/providers/catalog';
import { ProviderLogo } from './ProviderIcon';

type Kind = 'speech' | 'ai';

interface Props {
  providers: Record<ProviderId, ProviderConfig>;
  activeSttProvider: ProviderId;
  activeLlmProvider: ProviderId | 'none';
  smartCleanup: boolean;
  cleanupLevel: CleanupLevel;
  onUpdateSettings: (patch: Partial<SettingsState>) => void;
  onUpdateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  onOpenKeys: () => void;
}

const LEVELS = [
  { id: 'none', label: 'None' },
  { id: 'light', label: 'Light' },
  { id: 'medium', label: 'Medium' },
] as const;

/** The models a provider offers for a kind: the ones it reported, else the built-in list. */
function modelsOf(provider: ProviderConfig, kind: Kind): ProviderModel[] {
  const discovered = provider.discoveredModels?.[kind];
  if (discovered?.length) return discovered;
  const catalog = PROVIDER_CATALOG[provider.id];
  return kind === 'speech' ? catalog.sttModels : catalog.llmModels;
}

/** Shows a model by its short name: "Scribe v3", not "Scribe v3 (Latest · Recommended)" or "openai/gpt-oss-20b". */
export function modelName(provider: ProviderConfig, modelId: string, kind: Kind): string {
  const known = modelsOf(provider, kind).find((m) => m.id === modelId);
  const label = (known?.label ?? modelId).replace(/\s*\(.*\)\s*$/, '').trim();
  return label.slice(label.lastIndexOf('/') + 1) || modelId;
}

/** "Google Gemini" → "Gemini", "Custom / OpenAI-Compatible" → "Custom", so the row fits the sidebar. */
function shortName(name: string): string {
  return name.replace(/^(Google|Anthropic)\s+/, '').split(' / ')[0];
}

/** Which models run each dictation, whether their keys work, and a menu on each to switch them. */
export function SetupCard({
  providers,
  activeSttProvider,
  activeLlmProvider,
  smartCleanup,
  cleanupLevel,
  onUpdateSettings,
  onUpdateProvider,
  onOpenKeys,
}: Props) {
  const [open, setOpen] = useState<Kind | null>(null);
  const stt = providers[activeSttProvider];
  const llm = smartCleanup && activeLlmProvider !== 'none' ? providers[activeLlmProvider] : undefined;
  const sttReady = isProviderConfigured(stt);
  const llmReady = !llm || isProviderConfigured(llm);
  const failing = [stt, llm].find((p) => p && p.status === 'error');
  const status = !sttReady || !llmReady
    ? { label: 'Needs key', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', detail: 'Add an API key to start dictating' }
    : failing
      ? { label: 'Key failed', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', detail: failing.statusMessage || `${failing.name} rejected its key` }
      : { label: 'Ready', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', detail: 'Every key works' };

  // Providers with a key that can do this kind of work, the one in use first.
  const configured = (kind: Kind) => {
    const current = kind === 'speech' ? activeSttProvider : activeLlmProvider;
    return PROVIDER_ORDER
      .filter((id) =>
        (kind === 'speech' ? PROVIDER_CATALOG[id].supportsStt : PROVIDER_CATALOG[id].supportsLlm) &&
        isProviderConfigured(providers[id]))
      .sort((a, b) => Number(b === current) - Number(a === current));
  };

  const pick = (kind: Kind, id: ProviderId, model: string) => {
    if (kind === 'speech') {
      onUpdateProvider(id, { sttModel: model });
      onUpdateSettings({ activeSttProvider: id });
    } else {
      onUpdateProvider(id, { llmModel: model });
      onUpdateSettings({ activeLlmProvider: id, smartCleanup: true });
    }
    setOpen(null);
  };

  const setLevel = (level: (typeof LEVELS)[number]['id']) => {
    if (level === 'none') return onUpdateSettings({ smartCleanup: false });
    const provider = activeLlmProvider !== 'none' ? activeLlmProvider : configured('ai')[0];
    onUpdateSettings({ smartCleanup: true, cleanupLevel: level, ...(provider ? { activeLlmProvider: provider } : {}) });
  };

  const level = smartCleanup && activeLlmProvider !== 'none' ? cleanupLevel : 'none';
  const cleanupProvider = activeLlmProvider !== 'none' ? providers[activeLlmProvider] : undefined;

  return (
    <div className="p-1.5 rounded-[14px] bg-[var(--bg-card-solid)] shadow-xs">
      <div className="flex items-center justify-between px-1.5 pt-1 pb-1.5">
        <span className="text-[11px] font-semibold text-[var(--text-muted)]">Your setup</span>
        <span className={`flex items-center gap-1 text-[11px] font-semibold ${status.text}`} data-tooltip={status.detail}>
          <span className={`w-[6px] h-[6px] rounded-full ${status.dot}`} aria-hidden="true" />
          {status.label}
        </span>
      </div>

      <SetupRow
        role="Transcription"
        logo={<ProviderLogo id={stt.id} size={15} />}
        title={sttReady ? modelName(stt, stt.sttModel, 'speech') : 'Add API key'}
        subtitle={shortName(stt.name)}
        warn={!sttReady}
        open={open === 'speech'}
        onToggle={() => setOpen(open === 'speech' ? null : 'speech')}
        onClose={() => setOpen(null)}
      >
        <ModelList
          kind="speech"
          providers={providers}
          ids={configured('speech')}
          active={sttReady ? { id: stt.id, model: stt.sttModel } : undefined}
          onPick={(id, model) => pick('speech', id, model)}
          onOpenKeys={() => { setOpen(null); onOpenKeys(); }}
        />
      </SetupRow>

      <SetupRow
        role="Cleanup"
        logo={llm ? <ProviderLogo id={llm.id} size={15} /> : <span className="text-[11px] font-bold">Aa</span>}
        title={!llm ? 'Cleanup off' : llmReady ? modelName(llm, llm.llmModel, 'ai') : 'Add API key'}
        subtitle={llm ? `${shortName(llm.name)} · ${cleanupLevel === 'medium' ? 'Medium' : 'Light'}` : 'Raw transcript'}
        warn={!llmReady}
        muted={!llm}
        open={open === 'ai'}
        onToggle={() => setOpen(open === 'ai' ? null : 'ai')}
        onClose={() => setOpen(null)}
      >
        <div className="px-1.5 pt-1 pb-1.5">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">Cleanup level</div>
          <div role="radiogroup" aria-label="Cleanup level" className="grid grid-cols-3 gap-0.5 p-0.5 rounded-[9px] bg-[var(--bg-subtle)] dark:bg-black/25">
            {LEVELS.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={level === choice.id}
                onClick={() => setLevel(choice.id)}
                className={`py-1 rounded-[7px] text-[12px] font-semibold transition-colors ${
                  level === choice.id
                    ? 'bg-[var(--bg-card-solid)] dark:bg-[var(--bg-modal-active-nav)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-px bg-[var(--border-subtle)] my-1" />
        <ModelList
          kind="ai"
          providers={providers}
          ids={configured('ai')}
          active={cleanupProvider && isProviderConfigured(cleanupProvider) ? { id: cleanupProvider.id, model: cleanupProvider.llmModel } : undefined}
          onPick={(id, model) => pick('ai', id, model)}
          onOpenKeys={() => { setOpen(null); onOpenKeys(); }}
        />
      </SetupRow>

      {status.label !== 'Ready' && (
        <button
          type="button"
          onClick={onOpenKeys}
          className="w-full mt-1.5 py-2 rounded-full bg-[var(--accent-blue-fill)] hover:bg-[var(--accent-blue-hover)] text-white text-[12.5px] font-semibold transition-colors shadow-xs"
        >
          {status.label === 'Key failed' ? 'Fix API key' : 'Add API key'}
        </button>
      )}
    </div>
  );
}

function SetupRow({ role, logo, title, subtitle, warn, muted, open, onToggle, onClose, children }: {
  role: string;
  logo: ReactNode;
  title: string;
  subtitle: string;
  warn?: boolean;
  muted?: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const anchor = trigger.current;
    const popup = menu.current;
    if (!open || !anchor || !popup) return;
    // Opens beside the sidebar, its bottom level with the row, so it never covers the card.
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const edge = anchor.closest('aside')?.getBoundingClientRect().right ?? rect.right;
      popup.style.left = `${edge + 8}px`;
      popup.style.bottom = `${Math.max(8, window.innerHeight - rect.bottom - 6)}px`;
      popup.style.maxHeight = `${Math.min(420, rect.bottom - 8)}px`;
    };
    place();
    (popup.querySelector<HTMLElement>('[aria-checked="true"]') ?? popup.querySelector<HTMLElement>('button'))?.focus();
    const outside = (event: PointerEvent) => {
      if (!anchor.contains(event.target as Node) && !popup.contains(event.target as Node)) close.current();
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      trigger.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('button') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={onToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${role}: ${title}, ${subtitle}. Change`}
        className={`group w-full flex items-center gap-2.5 px-1.5 py-1.5 rounded-[10px] text-left transition-colors ${
          open ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
        }`}
      >
        <span
          className={`w-[28px] h-[28px] shrink-0 rounded-[8px] flex items-center justify-center ${
            warn
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : muted
                ? 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'
                : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
          }`}
        >
          {logo}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[12.5px] font-semibold leading-tight truncate ${
              warn ? 'text-amber-700 dark:text-amber-400' : muted ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
            }`}
          >
            {title}
          </span>
          <span className="block mt-[2px] text-[11px] leading-tight text-[var(--text-muted)] truncate">{subtitle}</span>
        </span>
        <ChevronsUpDown
          className={`w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] transition-opacity ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          ref={menu}
          role="dialog"
          aria-label={`Change ${role.toLowerCase()} model`}
          onKeyDown={onKeyDown}
          className="yy-option-menu z-50 w-[248px] select-none"
        >
          {children}
        </div>
      )}
    </>
  );
}

function ModelList({ kind, providers, ids, active, onPick, onOpenKeys }: {
  kind: Kind;
  providers: Record<ProviderId, ProviderConfig>;
  ids: ProviderId[];
  active?: { id: ProviderId; model: string };
  onPick: (id: ProviderId, model: string) => void;
  onOpenKeys: () => void;
}) {
  return (
    <div>
      {ids.map((id) => {
        const provider = providers[id];
        return (
          <div key={id} className="pb-1">
            <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[11px] font-semibold text-[var(--text-muted)]">
              <ProviderLogo id={id} size={12} />
              {provider.name}
            </div>
            {modelsOf(provider, kind).map((m) => {
              const checked = active?.id === id && active.model === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => onPick(id, m.id)}
                  title={m.label}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-left text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{modelName(provider, m.id, kind)}</span>
                  {checked && <Check className="w-3.5 h-3.5 shrink-0 text-[var(--accent-blue-fill)]" strokeWidth={2.4} />}
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="h-px bg-[var(--border-subtle)] my-1" />
      <button
        type="button"
        onClick={onOpenKeys}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-left text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:bg-[var(--bg-hover)] outline-none"
      >
        {ids.length ? <KeyRound className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        {ids.length ? 'Manage API keys' : 'Add a provider'}
      </button>
    </div>
  );
}
