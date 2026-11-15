import React, { useEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { findShortcutConflict, ShortcutSlot, shortcutModes } from '../../electron/shortcutBindings';
import {
  Globe,
  HelpCircle,
  Info,
  KeyRound,
  Keyboard,
  Mic,
  Monitor,
  MoreHorizontal,
  Pencil,
  Settings,
  X,
} from 'lucide-react';
import { InsightsStats } from '../services/stats';
import { isProviderConfigured, PROVIDER_CATALOG } from '../services/providers/catalog';
import { parseWritingPreferences, type ForgottenStyles, type StyleSampleSinceCorrection } from '../services/personalization';
import {
  ProviderConfig,
  ProviderId,
  SettingsModalTab,
  SettingsState,
} from '../types/app';
import { PersonalizationChart } from './PersonalizationChart';
import { CategoryIcon } from './CategoryIcon';
import { LanguageVariantsDialog, TranslationTargetsDialog } from './LanguageSettingsDialogs';
import { SelectMenu } from './SelectMenu';
import { ProviderSettings } from './ProviderSettings';
import { PersonalizationEditor } from './PersonalizationEditor';
import { SettingsSubdialog } from './SettingsSubdialog';

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
  onRemoveProvider: (id: ProviderId) => void;
  /** Styles learned since each correction, for suggesting an update. */
  recentStyleSamples: Record<string, StyleSampleSinceCorrection[]>;
  /** Forgets the learned style for one category and returns what to restore on Undo. */
  onForgetLearnedStyle: (categories: string[]) => ForgottenStyles;
  onRestoreLearnedStyle: (forgotten: ForgottenStyles) => void;
  /** Forgets every learned style and correction. Rules stay. */
  onResetLearnedStyle: () => void;
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

export function PersonalizationIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.5 18.5C8 15 12.5 9.5 12.5 5.5C12.5 4.2 11.6 3.5 10.6 3.5C9.3 3.5 8.5 4.9 8.5 7.5C8.5 12.5 9 18.5 12.5 19.5C15 20.2 17.2 18.2 17.2 15.8C17.2 14.3 16.1 13.5 14.9 13.5C13.5 13.5 12.6 14.8 12.6 16.4C12.6 18.3 14.4 19.5 17 19.5C18.2 19.5 19.2 19.1 20 18.5" />
    </svg>
  );
}

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
  onRemoveProvider,
  recentStyleSamples,
  onForgetLearnedStyle,
  onRestoreLearnedStyle,
  onResetLearnedStyle,
  stats,
  toast,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ message: string; url?: string }>();
  const [capturingTarget, setCapturingTarget] = useState<ShortcutSlot | null>(null);
  const [shortcutError, setShortcutError] = useState<{ target: ShortcutSlot; combo: string[] } | null>(null);
  const [languageDialog, setLanguageDialog] = useState<'targets' | 'variants' | null>(null);
  const [preferencesEditorOpen, setPreferencesEditorOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  /** The category to show first when the editor opens from a report row. */
  const [editorCategory, setEditorCategory] = useState<string>();
  const openPreferencesEditor = (category?: string) => {
    setHighlightedCat(null);
    setEditorCategory(category);
    setPreferencesEditorOpen(true);
  };
  const writingRules = parseWritingPreferences(settings.writingPreferences);
  const correctedStyles = stats.categoryBreakdown.filter((profile) => 'corrected' in profile && profile.corrected).length;
  const learnedStyles = stats.categoryBreakdown.length;
  const preferencesSummary = [
    writingRules.length > 0 && `${writingRules.length} ${writingRules.length === 1 ? 'rule' : 'rules'}`,
    correctedStyles > 0 && `${correctedStyles} corrected ${correctedStyles === 1 ? 'style' : 'styles'}`,
    learnedStyles > correctedStyles && `${learnedStyles - correctedStyles} learned ${learnedStyles - correctedStyles === 1 ? 'style' : 'styles'}`,
  ].filter(Boolean).join(' · ');
  const activeLlm = settings.activeLlmProvider;
  const editorProvider = activeLlm !== 'none' && PROVIDER_CATALOG[activeLlm].supportsLlm && isProviderConfigured(providers[activeLlm])
    ? providers[activeLlm]
    : undefined;
  const [microphones, setMicrophones] = useState<{ id: string; label: string }[]>([]);
  const [highlightedCat, setHighlightedCat] = useState<string | null>(null);
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
      setPreferencesEditorOpen(false);
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
    { id: 'providers', label: 'API Keys', icon: <KeyRound className="w-4 h-4" strokeWidth={1.8} /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" strokeWidth={1.8} /> },
    { id: 'personalization', label: 'Personalization', icon: <PersonalizationIcon className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" strokeWidth={1.8} /> },
    { id: 'help', label: 'Help', icon: <HelpCircle className="w-4 h-4" strokeWidth={1.8} /> },
  ];

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
        <div className="yy-side-surface w-[194px] shrink-0 bg-[var(--bg-modal-sidebar)] p-3 space-y-1">
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
            {activeTab === 'providers' && (
              <ProviderSettings
                providers={providers}
                settings={settings}
                onUpdateProvider={onUpdateProvider}
                onRemoveProvider={onRemoveProvider}
                onUpdateSettings={onUpdateSettings}
              />
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
                      Yap Yap learns your tone and phrasing per category through your configured AI provider. Transcripts you correct in History, including short excerpts of them, guide future formatting in the same category.
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-subtle)] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-medium">Context awareness</h3>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      Yap Yap always uses the focused app and website to pick the right style, and matches spacing and capitalization at your cursor on this device. With this on, a short excerpt around your cursor also goes to your AI provider so it can match names and what you have already written. The excerpt is never saved.
                    </p>
                  </div>
                  <Toggle label="Context awareness" checked={settings.contextAwareness} onChange={(contextAwareness) => onUpdateSettings({ contextAwareness })} />
                </div>

                {settings.personalizationEnabled && (
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--border-subtle)] px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">Writing preferences</h3>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {preferencesSummary || 'Tell Yap Yap how you want your text written, or correct what it has learned about you.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => openPreferencesEditor()}
                      className="inline-flex h-8 shrink-0 items-center rounded-full border border-[var(--border-strong)] px-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      {writingRules.length > 0 || stats.categoryBreakdown.length > 0 ? 'Edit' : 'Add a rule'}
                    </button>
                  </div>
                )}

                <div data-personalization-disabled={!settings.personalizationEnabled} className="yy-personalization-panel rounded-[18px] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-[var(--text-secondary)]">
                      Overall personalization:{' '}
                      <strong className="yy-personalization-score ml-1 text-lg font-bold text-[var(--text-primary)]">
                        {stats.personalizationPercent}%
                      </strong>
                    </p>
                    {settings.personalizationEnabled ? (
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
                        <div className="absolute right-0 top-full z-10 mt-1 grid overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-modal)] text-sm shadow-lg">
                          {(stats.categoryBreakdown.length > 0 || Object.keys(settings.styleCorrections).length > 0) && (
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              onClick={(event) => {
                                const details = event.currentTarget.closest('details');
                                if (details) {
                                  // Focus the menu button first: the dialog returns focus to it on Cancel.
                                  details.querySelector('summary')?.focus();
                                  details.open = false;
                                }
                                setConfirmResetOpen(true);
                              }}
                              className="whitespace-nowrap px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
                            >
                              Reset learned style
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(event) => {
                              const details = event.currentTarget.closest('details');
                              if (details) {
                                details.open = false;
                                details.querySelector('summary')?.focus();
                              }
                              setHighlightedCat(null);
                              onUpdateSettings({ personalizationEnabled: false });
                            }}
                            className="whitespace-nowrap px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
                          >
                            Disable personalization
                          </button>
                        </div>
                      </details>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ personalizationEnabled: true })}
                        className="yy-personalization-action inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-medium transition-colors"
                      >
                        Enable personalization
                      </button>
                    )}
                  </div>

                  <div className="yy-personalization-content mt-4 grid items-start gap-5">
                    <div className="mx-auto min-w-0 w-full max-w-[375px]">
                      <PersonalizationChart
                        sectors={stats.categoryBreakdown}
                        size={375}
                        activeCategory={settings.personalizationEnabled ? highlightedCat : null}
                        onHighlight={settings.personalizationEnabled ? setHighlightedCat : undefined}
                      />
                    </div>
                    {stats.categoryBreakdown.length > 0 ? (
                      <div className="min-w-0">
                        <div className="yy-personalization-columns grid gap-2 px-2 pb-1 text-xs text-[var(--text-secondary)]">
                          <span>Category</span>
                          <span className="text-center">Personalization</span>
                        </div>
                        <div className="divide-y divide-[var(--border-subtle)]">
                          {stats.categoryBreakdown.map((item) => (
                            <div
                              key={item.category}
                              tabIndex={settings.personalizationEnabled ? 0 : undefined}
                              data-highlighted={settings.personalizationEnabled && highlightedCat === item.category}
                              onPointerEnter={settings.personalizationEnabled ? () => setHighlightedCat(item.category) : undefined}
                              onPointerLeave={settings.personalizationEnabled ? () => setHighlightedCat(null) : undefined}
                              onFocus={settings.personalizationEnabled ? () => setHighlightedCat(item.category) : undefined}
                              onBlur={settings.personalizationEnabled ? () => setHighlightedCat(null) : undefined}
                              aria-describedby={settings.personalizationEnabled ? `style-${item.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined}
                              role={settings.personalizationEnabled ? 'button' : undefined}
                              aria-haspopup={settings.personalizationEnabled ? 'dialog' : undefined}
                              aria-label={settings.personalizationEnabled ? `${item.category}, ${item.percent}%. Open its learned style` : undefined}
                              onClick={settings.personalizationEnabled ? () => openPreferencesEditor(item.category) : undefined}
                              onKeyDown={settings.personalizationEnabled ? (event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                openPreferencesEditor(item.category);
                              } : undefined}
                              className="yy-personalization-row group/row relative yy-personalization-columns grid items-center gap-2 rounded-lg px-2 py-2.5 text-[12.5px] text-[var(--text-secondary)] data-[highlighted=true]:bg-[var(--bg-hover)] data-[highlighted=true]:text-[var(--text-primary)]"
                            >
                              {settings.personalizationEnabled && (
                                <div id={`style-${item.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} role="tooltip" className="yy-personalization-tooltip pointer-events-none invisible absolute left-2 top-full z-20 w-60 rounded-lg p-2.5 text-xs leading-relaxed shadow-lg group-data-[highlighted=true]/row:visible">
                                  <span className="block font-medium">{item.category}</span>
                                  {item.tone} · {item.phrasing}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                                  <CategoryIcon category={item.category} />
                                  <span className="truncate">{item.category}</span>
                                </div>
                              </div>
                              <span className="text-center tabular-nums">{item.percent}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="self-center text-center text-sm font-medium text-[var(--text-secondary)]">
                        Not Enough Data
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  Wedge width shows how much you dictate in a category; the fill shows how well Yap Yap knows your style there. Editing a transcript in History teaches it the most.
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
                  <p className="border-t border-[var(--border-subtle)] py-2 text-[12.5px] text-[var(--text-secondary)]">
                    <a href="https://icon-sets.iconify.design/solar/" target="_blank" rel="noreferrer" className="underline">
                      Solar icons
                    </a>{' by 480 Design · '}
                    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">
                      CC BY 4.0
                    </a>
                  </p>
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
        <div role="status" className="yy-toast fixed bottom-5 right-5 rounded-xl px-4 py-2.5 text-[12.5px] font-medium shadow-xl">
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
      {open && activeTab === 'personalization' && confirmResetOpen && (
        <SettingsSubdialog
          title="Reset learned style?"
          description="Yap Yap forgets the style it learned in every category, along with your corrections to it. Your rules, dictionary, and History text stay. It starts learning again from your next dictation."
          onClose={() => setConfirmResetOpen(false)}
        >
          <div className="yy-pref-confirm">
            <button type="button" className="yy-pref-button" onClick={() => setConfirmResetOpen(false)}>Cancel</button>
            <button
              type="button"
              className="yy-pref-button"
              data-danger
              onClick={() => {
                setConfirmResetOpen(false);
                setHighlightedCat(null);
                onResetLearnedStyle();
              }}
            >
              Reset learned style
            </button>
          </div>
        </SettingsSubdialog>
      )}
      {open && activeTab === 'personalization' && preferencesEditorOpen && (
        <PersonalizationEditor
          preferences={settings.writingPreferences}
          profiles={stats.categoryBreakdown}
          styleCorrections={settings.styleCorrections}
          focusCategory={editorCategory}
          recentSamples={recentStyleSamples}
          onForgetStyle={(category) => onForgetLearnedStyle([category])}
          onRestoreStyle={onRestoreLearnedStyle}
          provider={editorProvider}
          cleanupEnabled={settings.smartCleanup}
          onSave={(changes) => onUpdateSettings(changes)}
          onClose={() => setPreferencesEditorOpen(false)}
          onOpenProviders={() => {
            setPreferencesEditorOpen(false);
            onChangeTab('providers');
          }}
        />
      )}
    </dialog>
  );
}
