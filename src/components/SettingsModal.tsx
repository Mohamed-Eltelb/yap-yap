import React, { useEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { findShortcutConflict, ShortcutSlot, shortcutModes } from '../../electron/shortcutBindings';
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  HelpCircle,
  Info,
  KeyRound,
  Keyboard,
  Loader2,
  MessageSquare,
  Mic,
  Monitor,
  MoreHorizontal,
  Pencil,
  Share2,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import {
  PROVIDER_CATALOG,
  PROVIDER_ORDER,
} from '../services/providers/catalog';
import { testProviderConnection } from '../services/providers/engine';
import { InsightsStats } from '../services/stats';
import {
  PersonalizationCategory,
  ProviderConfig,
  ProviderId,
  SettingsModalTab,
  SettingsState,
} from '../types/app';
import { PersonalizationChart } from './PersonalizationChart';
import { LanguageVariantsDialog, TranslationTargetsDialog } from './LanguageSettingsDialogs';
import { SelectMenu } from './SelectMenu';

interface Props {
  open: boolean;
  openTranslationTargets: boolean;
  onTranslationTargetsOpened: () => void;
  activeTab: SettingsModalTab;
  onChangeTab: (tab: SettingsModalTab) => void;
  onClose: () => void;
  settings: SettingsState;
  onUpdateSettings: (patch: Partial<SettingsState>) => void;
  providers: Record<ProviderId, ProviderConfig>;
  onUpdateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  stats: InsightsStats;
  toast: string | null;
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-[var(--accent-blue-fill)]' : 'bg-[var(--bg-switch-off)]'
      }`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[21px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

function formatKeyName(e: KeyboardEvent): string {
  if (e.code === 'AltRight') return 'Right Alt';
  if (e.code === 'AltLeft') return 'Left Alt';
  if (e.code === 'ShiftRight') return 'Right Shift';
  if (e.code === 'ShiftLeft') return 'Left Shift';
  if (e.code === 'ControlRight') return 'Right Ctrl';
  if (e.code === 'ControlLeft') return 'Left Ctrl';
  if (e.code === 'Space') return 'Space';
  if (e.code.startsWith('Key')) return e.code.slice(3);
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

const shortcutLabels = {
  dictate: 'Dictate',
  translate: 'Translate',
  ask: 'Ask anything',
};

const shortcutDescriptions = {
  dictate: 'Press to start and stop dictation.',
  translate: 'Press to start and stop translation.',
  ask: 'Press to start and stop asking anything.',
};

export function SettingsModal({
  open,
  openTranslationTargets,
  onTranslationTargetsOpened,
  activeTab,
  onChangeTab,
  onClose,
  settings,
  onUpdateSettings,
  providers,
  onUpdateProvider,
  stats,
  toast,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ message: string; url?: string }>();
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [capturingTarget, setCapturingTarget] = useState<ShortcutSlot | null>(null);
  const [shortcutError, setShortcutError] = useState<{ target: ShortcutSlot; combo: string[] } | null>(null);
  const [languageDialog, setLanguageDialog] = useState<'targets' | 'variants' | null>(null);
  const [microphones, setMicrophones] = useState<{ id: string; label: string }[]>([]);
  const [editingCat, setEditingCat] = useState<PersonalizationCategory | null>(null);
  const [highlightedCat, setHighlightedCat] = useState<PersonalizationCategory | null>(null);
  const shortcutEditorOpen = open && activeTab === 'settings';

  useEffect(() => {
    if (!shortcutEditorOpen) return;
    window.yapyap?.setShortcutEditorOpen(true);
    return () => window.yapyap?.setShortcutEditorOpen(false);
  }, [shortcutEditorOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) {
      setLanguageDialog(null);
      return;
    }
    const opener = document.activeElement;
    dialog.showModal();
    closeButtonRef.current?.focus();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !openTranslationTargets) return;
    setLanguageDialog('targets');
    onTranslationTargetsOpened();
  }, [open, openTranslationTargets, onTranslationTargetsOpened]);

  const checkForUpdates = async () => {
    if (!window.yapyap) return;
    setCheckingUpdate(true);
    setUpdateResult(undefined);
    try {
      setUpdateResult(await window.yapyap.checkForUpdate());
    } catch {
      setUpdateResult({ message: 'Could not check for updates. Try again later.' });
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        const mics = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({
            id: d.deviceId || `mic-${i}`,
            label: d.label || `Microphone ${i + 1}`,
          }));
        setMicrophones(mics);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open || activeTab !== 'settings' || !capturingTarget) {
      if (capturingTarget) setCapturingTarget(null);
      if (!open || activeTab !== 'settings') setShortcutError(null);
      return;
    }
    const pressed = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturingTarget(null);
        return;
      }
      pressed.add(formatKeyName(e));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!pressed.size) return;
      e.preventDefault();
      e.stopPropagation();
      const combo = [...pressed];
      const conflict = findShortcutConflict(settings.shortcuts, capturingTarget, combo, window.yapyap?.platform);
      setCapturingTarget(null);
      if (conflict) {
        setShortcutError({ target: capturingTarget, combo });
        return;
      }
      const list = [...settings.shortcuts[capturingTarget.mode]];
      list[capturingTarget.index] = combo;
      onUpdateSettings({
        shortcuts: {
          ...settings.shortcuts,
          [capturingTarget.mode]: list,
        },
      });
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [open, activeTab, capturingTarget, settings.shortcuts, onUpdateSettings]);

  if (!open) return null;

  const navItems: { id: SettingsModalTab; label: string; icon: React.ReactNode }[] = [
    { id: 'providers', label: 'API Keys', icon: <KeyRound className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <SlidersHorizontal className="w-4 h-4" /> },
    { id: 'personalization', label: 'Personalization', icon: <UserCheck className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
    { id: 'help', label: 'Help', icon: <HelpCircle className="w-4 h-4" /> },
  ];

  const handleTestProvider = async (id: ProviderId) => {
    const provider = providers[id];
    onUpdateProvider(id, { status: 'testing', statusMessage: 'Testing connection...' });
    const res = await testProviderConnection(provider);
    onUpdateProvider(id, {
      status: res.ok ? 'connected' : 'error',
      statusMessage: res.message,
      lastTestedAt: new Date().toISOString(),
    });
    if (res.ok) {
      const meta = PROVIDER_CATALOG[id];
      const patch: Partial<SettingsState> = {};
      const currStt = providers[settings.activeSttProvider];
      if (meta.supportsStt && !currStt.apiKey.trim()) {
        patch.activeSttProvider = id;
      }
      if (
        meta.supportsLlm &&
        settings.activeLlmProvider !== 'none' &&
        !providers[settings.activeLlmProvider].apiKey.trim()
      ) {
        patch.activeLlmProvider = id;
      }
      if (Object.keys(patch).length > 0) {
        onUpdateSettings(patch);
      }
    }
  };

  const sttProviderOptions = PROVIDER_ORDER.filter((id) => PROVIDER_CATALOG[id].supportsStt);
  const llmProviderOptions = PROVIDER_ORDER.filter((id) => PROVIDER_CATALOG[id].supportsLlm);

  const providerOptionLabel = (id: ProviderId, model: 'sttModel' | 'llmModel') => {
    const provider = providers[id];
    const hasKey = provider.apiKey.trim().length > 0 || !PROVIDER_CATALOG[id].requiresKey;
    return `${provider.name} (${provider[model]})${hasKey ? '' : ' — No key'}`;
  };

  const categoryIcons: Record<PersonalizationCategory, React.ReactNode> = {
    'AI assistants': <Sparkles className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
    Messaging: <MessageSquare className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
    'Social platforms': <Share2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
    'Development tools': <Code2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
  };

  const startShortcutCapture = (target: ShortcutSlot) => {
    setShortcutError(null);
    setCapturingTarget(target);
  };

  const removeShortcutSlot = (mode: ShortcutSlot['mode'], index: number) => {
    if (mode === 'dictate' && settings.shortcuts.dictate.length <= 1) return;
    setCapturingTarget(null);
    setShortcutError(null);
    onUpdateSettings({
      shortcuts: {
        ...settings.shortcuts,
        [mode]: settings.shortcuts[mode].filter((_, i) => i !== index),
      },
    });
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Yap Yap settings"
      className="m-auto w-[calc(100%-2rem)] max-w-[860px] overflow-visible bg-transparent backdrop:bg-[var(--bg-modal-backdrop)] backdrop:backdrop-blur-[1.5px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[860px] h-[610px] max-h-[90vh] rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-subtle)] shadow-[var(--shadow-modal)] flex overflow-hidden"
      >
        {/* Modal Left Nav matching Images 7, 8, 10, 11, 14 */}
        <div className="w-[194px] shrink-0 bg-[var(--bg-modal-sidebar)] border-r border-[var(--border-subtle)] p-3 space-y-1">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] text-[13px] font-medium transition-colors ${
                  active
                    ? 'bg-[var(--bg-modal-active-nav)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Right Content */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex-1 overflow-y-auto px-8 py-7">
            {/* TAB 1: PROVIDERS & API KEYS */}
            {activeTab === 'providers' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-[21px] font-semibold text-[var(--text-primary)]">
                    Providers &amp; API Keys
                  </h2>
                  <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
                    Provide your own API keys. Keys stay stored locally on this device and are sent directly to your chosen provider.
                  </p>
                </div>

                {/* Active Defaults Selector */}
                <div className="rounded-xl bg-[var(--bg-subtle)]/75 border border-[var(--border-subtle)] p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="default-stt-provider" className="block text-[11.5px] font-medium text-[var(--text-secondary)] mb-1.5">
                      Default Dictation (Speech-to-Text)
                    </label>
                    <SelectMenu
                      id="default-stt-provider"
                      label="Default Dictation (Speech-to-Text)"
                      value={settings.activeSttProvider}
                      options={sttProviderOptions.map((id) => ({
                        value: id,
                        label: providerOptionLabel(id, 'sttModel'),
                      }))}
                      onChange={(activeSttProvider) => onUpdateSettings({ activeSttProvider })}
                    />
                  </div>

                  <div>
                    <label htmlFor="default-llm-provider" className="block text-[11.5px] font-medium text-[var(--text-secondary)] mb-1.5">
                      Default AI (Cleanup, Translate &amp; Ask)
                    </label>
                    <SelectMenu
                      id="default-llm-provider"
                      label="Default AI (Cleanup, Translate & Ask)"
                      value={settings.activeLlmProvider}
                      options={[
                        ...llmProviderOptions.map((id) => ({ value: id, label: providerOptionLabel(id, 'llmModel') })),
                        { value: 'none', label: 'None (Raw Speech-to-Text only)' },
                      ]}
                      onChange={(activeLlmProvider) => onUpdateSettings({ activeLlmProvider })}
                    />
                  </div>
                </div>

                {/* Provider List */}
                <div className="space-y-3">
                  {PROVIDER_ORDER.map((id) => {
                    const meta = PROVIDER_CATALOG[id];
                    const cfg = providers[id];
                    const isSttActive = settings.activeSttProvider === id;
                    const isLlmActive = settings.activeLlmProvider === id;
                    const revealed = Boolean(revealedKeys[id]);

                    return (
                      <div
                        key={id}
                        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] p-4 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                                {meta.name}
                              </span>
                              {isSttActive ? (
                                <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]">
                                  Active STT
                                </span>
                              ) : (
                                meta.supportsStt && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdateSettings({ activeSttProvider: id })
                                    }
                                    className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                  >
                                    Use for STT
                                  </button>
                                )
                              )}
                              {isLlmActive ? (
                                <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                  Active AI
                                </span>
                              ) : (
                                meta.supportsLlm && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdateSettings({ activeLlmProvider: id })
                                    }
                                    className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                  >
                                    Use for AI
                                  </button>
                                )
                              )}
                              {cfg.status === 'connected' && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Verified</span>
                                </span>
                              )}
                              {cfg.status === 'error' && (
                                <span
                                  title={cfg.statusMessage}
                                  className="inline-flex items-center gap-1 text-[11px] text-red-500"
                                >
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span className="truncate max-w-[200px]">
                                    {cfg.statusMessage || 'Error'}
                                  </span>
                                </span>
                              )}
                            </div>
                            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                              {meta.tagline}
                            </p>
                          </div>

                          <a
                            href={meta.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
                          >
                            <span>Get key</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>

                        {/* API Key + Test Button */}
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              type={revealed ? 'text' : 'password'}
                              value={cfg.apiKey}
                              onChange={(e) =>
                                onUpdateProvider(id, {
                                  apiKey: e.target.value,
                                  status: 'idle',
                                  statusMessage: undefined,
                                })
                              }
                              placeholder={meta.keyPlaceholder}
                              className="w-full pl-3 pr-9 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedKeys((prev) => ({ ...prev, [id]: !prev[id] }))
                              }
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              aria-label={revealed ? 'Hide API key' : 'Show API key'}
                            >
                              {revealed ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          <button
                            type="button"
                            disabled={cfg.status === 'testing'}
                            onClick={() => handleTestProvider(id)}
                            className="px-3.5 py-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] text-[12px] font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5 disabled:opacity-60 transition-colors"
                          >
                            {cfg.status === 'testing' && (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            )}
                            <span>Test</span>
                          </button>
                        </div>

                        {/* Custom Base URL (shown for Custom or editable if needed) */}
                        {id === 'custom' && (
                          <div>
                            <label className="block text-[11px] text-[var(--text-secondary)] mb-1">
                              OpenAI-Compatible Base URL
                            </label>
                            <input
                              type="text"
                              value={cfg.baseUrl ?? ''}
                              onChange={(e) =>
                                onUpdateProvider(id, { baseUrl: e.target.value, status: 'idle' })
                              }
                              placeholder="http://localhost:11434/v1"
                              className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12px] text-[var(--text-primary)] focus:outline-none"
                            />
                          </div>
                        )}

                        {/* Model Selectors */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {meta.supportsStt && (
                            <div>
                              <label htmlFor={`sttModel-${id}`} className="block text-[11px] text-[var(--text-secondary)] mb-1">
                                Speech model
                              </label>
                              {id === 'custom' ? (
                                <input
                                  type="text"
                                  id={`sttModel-${id}`}
                                  value={cfg.sttModel}
                                  onChange={(e) =>
                                    onUpdateProvider(id, { sttModel: e.target.value })
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-primary)] focus:outline-none"
                                />
                              ) : (
                                <SelectMenu
                                  id={`sttModel-${id}`}
                                  label={`${cfg.name} speech model`}
                                  value={cfg.sttModel}
                                  options={meta.sttModels.map((model) => ({ value: model.id, label: model.label }))}
                                  onChange={(sttModel) => onUpdateProvider(id, { sttModel })}
                                />
                              )}
                            </div>
                          )}

                          {meta.supportsLlm && (
                            <div>
                              <label htmlFor={`llmModel-${id}`} className="block text-[11px] text-[var(--text-secondary)] mb-1">
                                AI / Translation model
                              </label>
                              {id === 'custom' ? (
                                <input
                                  type="text"
                                  id={`llmModel-${id}`}
                                  value={cfg.llmModel}
                                  onChange={(e) =>
                                    onUpdateProvider(id, { llmModel: e.target.value })
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-primary)] focus:outline-none"
                                />
                              ) : (
                                <SelectMenu
                                  id={`llmModel-${id}`}
                                  label={`${cfg.name} ai / translation model`}
                                  value={cfg.llmModel}
                                  options={meta.llmModels.map((model) => ({ value: model.id, label: model.label }))}
                                  onChange={(llmModel) => onUpdateProvider(id, { llmModel })}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: SETTINGS (Exact match to Images 8, 9, 14) */}
            {activeTab === 'settings' && (
              <div className="space-y-8">
                <h2 className="text-[22px] font-semibold text-[var(--text-primary)]">
                  Settings
                </h2>

                {/* Shortcuts Section */}
                <div>
                  <div className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)] pb-2.5 border-b border-[var(--border-subtle)]">
                    <Keyboard className="w-4 h-4" />
                    <span>Shortcuts</span>
                  </div>

                  <div className="yy-shortcut-list">
                    {shortcutModes.map((mode) => {
                      const title = shortcutLabels[mode];
                      const combos = settings.shortcuts[mode];
                      const rowError = shortcutError?.target.mode === mode ? shortcutError : null;
                      const activeSlot = capturingTarget ?? rowError?.target;
                      const adding = activeSlot?.mode === mode && activeSlot.index === combos.length;
                      return (
                        <div
                          key={mode}
                          className="yy-shortcut-row"
                        >
                          <div>
                            <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                              {title}
                            </div>
                            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                              {shortcutDescriptions[mode]}
                            </p>
                          </div>

                          <div className="yy-shortcut-controls">
                            {(adding ? [...combos, rowError?.combo ?? []] : combos).map((combo, idx) => {
                              const isCapturing =
                                capturingTarget?.mode === mode &&
                                capturingTarget?.index === idx;
                              const canRemove = idx < combos.length && (mode !== 'dictate' || combos.length > 1);
                              const errorId = rowError?.target.index === idx ? `shortcut-error-${mode}-${idx}` : undefined;
                              return (
                                <div key={idx} className="w-full">
                                  <div className="yy-shortcut-field" data-capturing={isCapturing}>
                                    <button
                                      type="button"
                                      className="yy-shortcut-edit"
                                      aria-label={`Edit ${title} shortcut ${idx + 1}: ${isCapturing ? 'Press keys' : combo.join(' + ')}`}
                                      aria-describedby={errorId}
                                      aria-invalid={errorId ? true : undefined}
                                      onClick={() => startShortcutCapture({ mode, index: idx })}
                                    >
                                      {isCapturing ? (
                                        <span role="status" className="yy-shortcut-prompt">Press keys…</span>
                                      ) : (
                                        combo.map((key, ki) => (
                                          <span key={ki} className="yy-keycap">
                                            {key}
                                          </span>
                                        ))
                                      )}
                                    </button>
                                    {canRemove && (
                                      <button
                                        type="button"
                                        aria-label={`Remove ${title} shortcut ${idx + 1}`}
                                        className="yy-shortcut-remove"
                                        onClick={(event) => {
                                          const controls = event.currentTarget.closest('.yy-shortcut-controls');
                                          removeShortcutSlot(mode, idx);
                                          controls?.querySelector<HTMLButtonElement>('.yy-shortcut-add')?.focus();
                                        }}
                                      >
                                        <X size={16} aria-hidden="true" />
                                      </button>
                                    )}
                                  </div>
                                  {errorId && (
                                    <p id={errorId} role="alert" className="mt-1 px-1 text-[12px] text-red-700 dark:text-red-300">
                                      This shortcut is already in use
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                            <button
                              type="button"
                              aria-label={`Add another ${title} shortcut`}
                              onClick={() => startShortcutCapture({ mode, index: combos.length })}
                              className="yy-shortcut-add"
                            >
                              Add another
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Language Section */}
                <div>
                  <div className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)] pb-2.5 border-b border-[var(--border-subtle)]">
                    <Globe className="w-4 h-4" />
                    <span>Language</span>
                  </div>

                  <div>
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Interface language
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                            The app interface is available in English.
                        </p>
                      </div>
                    </div>

                    <div className="py-2.5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                            Translation targets
                          </div>
                          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                            Choose up to 3 target languages for your dictation in translation mode.
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Edit translation targets: ${settings.translationTargets.join(', ') || 'None selected'}`}
                          aria-haspopup="dialog"
                          onClick={() => setLanguageDialog('targets')}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-w-[210px]"
                        >
                          <span className="truncate">
                            {settings.translationTargets.join(', ') || 'Select languages'}
                          </span>
                          <Pencil className="w-3.5 h-3.5 shrink-0 text-[var(--text-secondary)]" />
                        </button>
                      </div>
                    </div>

                    <div className="py-2.5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                            Language variants
                          </div>
                          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                            Choose your preferred language variants for the best experience.
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => setLanguageDialog('variants')}
                          className="px-3.5 py-1.5 rounded-full bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        >
                          Select language variants
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Audio Section */}
                <div>
                  <div className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)] pb-2.5 border-b border-[var(--border-subtle)]">
                    <Mic className="w-4 h-4" />
                    <span>Audio</span>
                  </div>

                  <div>
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Microphone
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Choose your preferred microphone for Yap Yap to capture your voice.
                        </p>
                      </div>
                      <SelectMenu
                        label="Microphone"
                        value={settings.microphoneId}
                        className="max-w-[230px]"
                        placeholder="Microphone unavailable"
                        options={[
                          { value: 'default', label: 'Auto-detect (System Default)' },
                          ...microphones.filter((mic) => mic.id !== 'default').map((mic) => ({ value: mic.id, label: mic.label })),
                        ]}
                        onChange={(microphoneId) => onUpdateSettings({ microphoneId })}
                      />
                    </div>

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Interaction sounds
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Play sounds for key actions like start/stop.
                        </p>
                      </div>
                      <Toggle
                        label="Interaction sounds"
                        checked={settings.interactionSounds}
                        onChange={(val) => onUpdateSettings({ interactionSounds: val })}
                      />
                    </div>

                    {window.yapyap && <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Mute when dictating
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Automatically silence other active audio during dictation.
                        </p>
                      </div>
                      <Toggle
                        label="Mute when dictating"
                        checked={settings.muteWhenDictating}
                        onChange={(val) => onUpdateSettings({ muteWhenDictating: val })}
                      />
                    </div>}
                  </div>
                </div>

                {/* General Section */}
                <div>
                  <div className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)] pb-2.5 border-b border-[var(--border-subtle)]">
                    <Monitor className="w-4 h-4" />
                    <span>General</span>
                  </div>

                  <div>
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Appearance
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Choose between light and dark modes.
                        </p>
                      </div>
                      <SelectMenu
                        label="Appearance"
                        value={settings.appearance}
                        className="w-[112px]"
                        options={[
                          { value: 'system', label: 'System' },
                          { value: 'light', label: 'Light' },
                          { value: 'dark', label: 'Dark' },
                        ]}
                        onChange={(appearance) => onUpdateSettings({ appearance })}
                      />
                    </div>

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Launch app at login
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Open Yap Yap automatically when your computer starts.
                        </p>
                      </div>
                      <Toggle
                        label="Launch app at login"
                        checked={settings.launchAtLogin}
                        onChange={(val) => onUpdateSettings({ launchAtLogin: val })}
                      />
                    </div>

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Smart AI cleanup
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Remove filler words and auto-format punctuation using your AI provider.
                        </p>
                      </div>
                      <Toggle
                        label="Smart AI cleanup"
                        checked={settings.smartCleanup}
                        onChange={(val) => onUpdateSettings({ smartCleanup: val })}
                      />
                    </div>

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Auto-paste into focused app
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Automatically copy and paste dictation output to your active cursor.
                        </p>
                      </div>
                      <Toggle
                        label="Auto-paste into focused app"
                        checked={settings.autoPaste}
                        onChange={(val) => onUpdateSettings({ autoPaste: val })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'personalization' && (
              <div className="yy-personalization-report space-y-5 text-[var(--text-primary)]" onPointerLeave={() => setHighlightedCat(null)}>
                <div className="flex items-center gap-1.5 pr-8">
                  <h2 className="text-[25px] font-medium tracking-tight">Personalization</h2>
                  <div className="group relative">
                    <button type="button" aria-label="About personalization" aria-describedby="personalization-tooltip" className="rounded p-1 text-[var(--text-secondary)]">
                      <Info aria-hidden="true" className="size-3.5" />
                    </button>
                    <div id="personalization-tooltip" role="tooltip" className="yy-personalization-tooltip invisible absolute left-0 top-full z-20 mt-1 w-60 rounded-lg p-2.5 text-xs leading-relaxed shadow-lg group-hover:visible group-focus-within:visible">
                      Yap Yap uses category instructions and learned words to adapt how it formats your dictation.
                    </div>
                  </div>
                </div>

                <div className="yy-personalization-panel rounded-[18px] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-[var(--text-secondary)]">
                      Overall personalization{' '}
                      <strong className="ml-1 text-lg font-bold text-[var(--text-primary)]">
                        {stats.personalizationPercent}%
                      </strong>
                      {!settings.personalizationEnabled && <span className="ml-2 text-xs">Off</span>}
                    </p>
                    <details
                      className="yy-personalization-options relative shrink-0"
                      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape' || !event.currentTarget.open) return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.open = false;
                        event.currentTarget.querySelector('summary')?.focus();
                      }}
                    >
                      <summary aria-label="Personalization options" className="grid size-8 cursor-pointer list-none place-items-center rounded-lg hover:bg-[var(--bg-hover)]">
                        <MoreHorizontal aria-hidden="true" size={16} />
                      </summary>
                      <button
                        type="button"
                        onClick={(event) => {
                          const details = event.currentTarget.closest('details');
                          if (details) {
                            details.open = false;
                            details.querySelector('summary')?.focus();
                          }
                          onUpdateSettings({ personalizationEnabled: !settings.personalizationEnabled });
                        }}
                        className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-modal)] px-3 py-2.5 text-sm shadow-lg hover:bg-[var(--bg-hover)]"
                      >
                        {settings.personalizationEnabled ? 'Disable personalization' : 'Enable personalization'}
                      </button>
                    </details>
                  </div>

                  <div className="yy-personalization-content mt-4 grid items-start gap-5">
                    <div className="mx-auto min-w-0 w-full max-w-[375px]">
                      <PersonalizationChart sectors={stats.categoryBreakdown} size={375} activeCategory={highlightedCat ?? editingCat} onHighlight={setHighlightedCat} />
                    </div>
                    <div className="min-w-0">
                      <div className="yy-personalization-columns grid gap-2 px-2 pb-1 text-xs text-[var(--text-secondary)]">
                        <span>Category</span>
                        <span className="text-center">Personalization</span>
                      </div>
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {stats.categoryBreakdown.map((item) => (
                          <div key={item.category}>
                            <button
                              type="button"
                              aria-expanded={editingCat === item.category}
                              data-highlighted={(highlightedCat ?? editingCat) === item.category}
                              onPointerEnter={() => setHighlightedCat(item.category)}
                              onPointerLeave={() => setHighlightedCat(null)}
                              onFocus={() => setHighlightedCat(item.category)}
                              onBlur={() => setHighlightedCat(null)}
                              onClick={() => setEditingCat(editingCat === item.category ? null : item.category)}
                              className="yy-personalization-columns grid w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-[12.5px] text-[var(--text-secondary)] data-[highlighted=true]:bg-[var(--bg-hover)] data-[highlighted=true]:text-[var(--text-primary)]"
                            >
                              <span className="flex items-center gap-1.5 whitespace-nowrap [&>svg]:shrink-0">
                                {categoryIcons[item.category]}
                                {item.category}
                              </span>
                              <span className="text-center tabular-nums">{item.percent}%</span>
                            </button>
                            {editingCat === item.category && (
                              <textarea
                                rows={2}
                                aria-label={item.category + ' formatting instructions'}
                                value={settings.categoryInstructions[item.category]}
                                onChange={(event) => onUpdateSettings({
                                  categoryInstructions: {
                                    ...settings.categoryInstructions,
                                    [item.category]: event.target.value,
                                  },
                                })}
                                className="mb-2 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-input)] p-2.5 text-xs"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  Select a category to edit its formatting instructions.
                </p>
              </div>
            )}

            {/* TAB 4: ABOUT (Exact match to Image 11) */}
            {activeTab === 'about' && (
              <div className="space-y-6">
                <h2 className="text-[22px] font-semibold text-[var(--text-primary)]">
                  About
                </h2>

                <div className="space-y-5">
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-[14px] font-medium text-[var(--text-primary)]">
                        Version
                      </div>
                      <div className="text-[13px] text-[var(--text-secondary)] mt-0.5">
                        v{version} · Yap Yap Desktop (BYOK)
                      </div>
                    </div>
                    {window.yapyap && (
                      <button
                        type="button"
                        onClick={() => void checkForUpdates()}
                        disabled={checkingUpdate}
                        className="px-4 py-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-card-solid)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] transition-colors disabled:opacity-60"
                      >
                        {checkingUpdate ? 'Checking…' : 'Check for updates'}
                      </button>
                    )}
                  </div>
                  {updateResult && (
                    <div role="status" className="text-[13px] text-[var(--text-secondary)]">
                      {updateResult.message}
                      {updateResult.url && (
                        <a href={updateResult.url} target="_blank" rel="noreferrer" className="ms-2 underline">
                          View releases
                        </a>
                      )}
                    </div>
                  )}

                  <div className="py-2 flex items-center justify-between border-t border-[var(--border-subtle)]">
                    <div>
                      <div className="text-[14px] font-medium text-[var(--text-primary)]">
                        Local-first privacy
                      </div>
                      <div className="text-[12.5px] text-[var(--text-secondary)] mt-0.5">
                        Yap Yap stores your history locally. Cloud providers receive the audio or text needed for each request.
                      </div>
                    </div>
                  </div>

                  <div className="py-2 flex items-center justify-between border-t border-[var(--border-subtle)]">
                    <div>
                      <div className="text-[14px] font-medium text-[var(--text-primary)]">
                        Supported Providers
                      </div>
                      <div className="text-[12.5px] text-[var(--text-secondary)] mt-0.5">
                        OpenAI, Groq, Google Gemini, Anthropic Claude, Deepgram, ElevenLabs &amp; Custom OpenAI-compatible endpoints.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: HELP */}
            {activeTab === 'help' && (
              <div className="space-y-5">
                <h2 className="text-[22px] font-semibold text-[var(--text-primary)]">
                  Help &amp; Quick Start
                </h2>

                <div className="space-y-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  <div className="p-4 rounded-xl bg-[var(--bg-subtle)]/75 border border-[var(--border-subtle)]">
                    <div className="font-semibold text-[var(--text-primary)] mb-1">
                      1. Add an API Key
                    </div>
                    Open <strong className="text-[var(--text-primary)]">API Keys</strong> and paste a key from Groq (fast &amp; free tier), OpenAI, Google Gemini, Deepgram, ElevenLabs, or point Custom to a local Ollama/Whisper server. Click <strong className="text-[var(--text-primary)]">Test</strong> to verify.
                  </div>

                  <div className="p-4 rounded-xl bg-[var(--bg-subtle)]/75 border border-[var(--border-subtle)]">
                    <div className="font-semibold text-[var(--text-primary)] mb-1">
                      2. Dictate, Translate, or Ask Anything
                    </div>
                    Use the floating dictation bar, click <strong className="text-[var(--text-primary)]">Quick dictate</strong>, or trigger your configured shortcut. Speak naturally — your custom Dictionary words are automatically passed as hints!
                  </div>

                  <div className="p-4 rounded-xl bg-[var(--bg-subtle)]/75 border border-[var(--border-subtle)]">
                    <div className="font-semibold text-[var(--text-primary)] mb-1">
                      3. Retry or Download Anytime
                    </div>
                    In <strong className="text-[var(--text-primary)]">History</strong>, hover any transcript and open the <strong className="text-[var(--text-primary)]">•••</strong> menu to re-process saved audio with a different provider or download the audio clip.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <div role="status" className="fixed bottom-5 right-5 rounded-xl border border-white/10 bg-[#141416] px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl">
          {toast}
        </div>
      )}
      {languageDialog === 'targets' && (
        <TranslationTargetsDialog
          targets={settings.translationTargets}
          onChange={(translationTargets) => onUpdateSettings({ translationTargets })}
          onClose={() => setLanguageDialog(null)}
        />
      )}
      {languageDialog === 'variants' && (
        <LanguageVariantsDialog
          variants={settings.languageVariants}
          onChange={(languageVariants) => onUpdateSettings({ languageVariants })}
          onClose={() => setLanguageDialog(null)}
        />
      )}
    </dialog>
  );
}
