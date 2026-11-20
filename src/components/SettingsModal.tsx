import React, { useEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { addCapturedKey, findShortcutConflict, pauseHoldCombo, reservedShortcut, ShortcutSlot, shortcutModes } from '../../electron/shortcutBindings';
import {
  ArrowUpRight,
  ChevronRight,
  Globe,
  HelpCircle,
  Info,
  KeyRound,
  Keyboard,
  Mic,
  Monitor,
  MoreHorizontal,
  Settings,
  X,
} from 'lucide-react';
import { InsightsStats } from '../services/stats';
import { isProviderConfigured, PROVIDER_CATALOG } from '../services/providers/catalog';
import { parseWritingPreferences, presetOf, STYLE_PRESETS, withPickedStyles, type DestinationEntry, type ForgottenStyles, type SourceChoice, type StyleSampleSinceCorrection } from '../services/personalization';
import {
  ProviderConfig,
  ProviderId,
  SettingsModalTab,
  SettingsState,
} from '../types/app';
import { PersonalizationChart } from './PersonalizationChart';
import { CategoryIcon } from './CategoryIcon';
import { LanguageVariantsDialog, TranslationTargetsDialog, SpokenLanguagesDialog } from './LanguageSettingsDialogs';
import { SelectMenu } from './SelectMenu';
import { isMicrophoneMissing, MicrophoneDialog } from './MicrophoneDialog';
import { ProviderSettings } from './ProviderSettings';
import { feedbackUrl, siteLinks } from '../data/links';
import { UpdateDialog } from './UpdateDialog';
import { PersonalizationEditor } from './PersonalizationEditor';
import { SettingsSubdialog } from './SettingsSubdialog';
import { SourceCategoriesDialog } from './SourceCategoriesDialog';
import { Toggle } from './Toggle';
import { StartingStylesDialog } from './StartingStylesDialog';

interface Props {
  open: boolean;
  openTranslationTargets: boolean;
  onTranslationTargetsOpened: () => void;
  /** Called with true while a shortcut field records keys, and false when it stops. */
  onCapturingShortcutChange?: (capturing: boolean) => void;
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
  /** Apps and sites the user dictated into or set a kind of place for. */
  destinations: DestinationEntry[];
  stats: InsightsStats;
  toast: string | null;
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

/** AI cleanup levels, as Wispr Flow names them. None is cleanup off. */
const CLEANUP_CHOICES = [
  { id: 'none', label: 'None', description: 'Your words exactly as transcribed' },
  { id: 'light', label: 'Light', description: 'Removes filler words, fixes grammar and punctuation' },
  { id: 'medium', label: 'Medium', description: 'Also rewords for clarity, keeping your meaning' },
] as const;

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

/** Holding a hook shortcut while recording pauses it; it follows the shortcut, so it has nothing to edit. */
export function PauseShortcutRow({ combo }: { combo: string[] }) {
  return (
    <div className="yy-shortcut-row">
      <div>
        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">Pause and resume</div>
        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">Hold while recording to pause or resume.</p>
      </div>
      <div className="yy-shortcut-controls">
        <div className="yy-shortcut-field" data-readonly="true">
          <span className="yy-shortcut-edit">
            <span className="yy-shortcut-hold">Hold</span>
            {combo.map((key) => (
              <span key={key} className="yy-keycap">{key}</span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

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
  destinations,
  stats,
  toast,
  onCapturingShortcutChange,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [capturingTarget, setCapturingTarget] = useState<ShortcutSlot | null>(null);
  const [shortcutError, setShortcutError] = useState<{ target: ShortcutSlot; combo: string[]; reason: 'used' | 'reserved' } | null>(null);
  const [languageDialog, setLanguageDialog] = useState<'targets' | 'variants' | 'spoken' | null>(null);
  const [preferencesEditorOpen, setPreferencesEditorOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const chosenSources = destinations.filter((entry) => entry.choice).length;
  const sourcesSummary = destinations.length
    ? [
        `${destinations.length} ${destinations.length === 1 ? 'app or site' : 'apps and sites'}`,
        chosenSources > 0 && `${chosenSources} set by you`,
      ].filter(Boolean).join(' · ')
    : 'Choose what kind of place an app or site is, or stop learning there.';
  /** The category to show first when the editor opens from a report row. */
  const [editorCategory, setEditorCategory] = useState<string>();
  const openPreferencesEditor = (category?: string) => {
    setHighlightedCat(null);
    setEditorCategory(category);
    setPreferencesEditorOpen(true);
  };
  const writingRules = parseWritingPreferences(settings.writingPreferences);
  const pickedStyles = Object.entries(settings.styleCorrections).flatMap(([category, correction]) => {
    const preset = STYLE_PRESETS.find((item) => item.id === presetOf(correction));
    return preset ? [`${preset.label} in ${category}`] : [];
  });
  const defaultPreset = STYLE_PRESETS.find((item) => item.id === settings.defaultStyle);
  if (defaultPreset) pickedStyles.unshift(`${defaultPreset.label} everywhere else`);
  const stylesSummary = pickedStyles.length
    ? pickedStyles.slice(0, 2).join(' · ') + (pickedStyles.length > 2 ? ` · ${pickedStyles.length - 2} more` : '')
    : 'Pick Formal, Casual, or Very casual for each kind of place, or let Yap Yap learn your style.';
  const correctedStyles = stats.categoryBreakdown.filter((profile) => 'corrected' in profile && profile.corrected).length;
  const learnedStyles = stats.categoryBreakdown.length;
  const preferencesSummary = [
    writingRules.length > 0 && `${writingRules.length} ${writingRules.length === 1 ? 'rule' : 'rules'}`,
    correctedStyles > 0 && `${correctedStyles} corrected ${correctedStyles === 1 ? 'style' : 'styles'}`,
    learnedStyles > correctedStyles && `${learnedStyles - correctedStyles} learned ${learnedStyles - correctedStyles === 1 ? 'style' : 'styles'}`,
  ].filter(Boolean).join(' · ');
  const activeLlm = settings.activeLlmProvider;
  // The same provider cleanup uses: the selected one, or another set-up AI provider when the
  // selected one has no key yet.
  const editorProvider = activeLlm === 'none'
    ? undefined
    : PROVIDER_CATALOG[activeLlm].supportsLlm && isProviderConfigured(providers[activeLlm])
      ? providers[activeLlm]
      : Object.values(providers).find((provider) => PROVIDER_CATALOG[provider.id].supportsLlm && isProviderConfigured(provider));
  const [microphones, setMicrophones] = useState<{ id: string; label: string }[]>([]);
  const [microphoneDialogOpen, setMicrophoneDialogOpen] = useState(false);
  // Until the app may use the microphone, the system hides device names and ids.
  const [microphonesKnown, setMicrophonesKnown] = useState(false);
  const microphoneMissing = isMicrophoneMissing(settings.microphoneId, microphones, microphonesKnown);
  const microphoneLabel = settings.microphoneId === 'default'
    ? 'Auto-detect'
    : microphoneMissing
      ? 'Saved microphone (not connected)'
      : microphones.find((mic) => mic.id === settings.microphoneId)?.label ?? 'Saved microphone';
  const [highlightedCat, setHighlightedCat] = useState<string | null>(null);
  // Shortcuts stay off only while a shortcut field records keys, so pressing the new
  // shortcut does not also start a dictation. The rest of Settings can be dictated into.
  const capturingShortcut = open && activeTab === 'settings' && capturingTarget !== null;

  useEffect(() => {
    if (!capturingShortcut) return;
    window.yapyap?.setShortcutEditorOpen(true);
    onCapturingShortcutChange?.(true);
    return () => {
      window.yapyap?.setShortcutEditorOpen(false);
      onCapturingShortcutChange?.(false);
    };
  }, [capturingShortcut, onCapturingShortcutChange]);

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

  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  const refreshMicrophones = React.useCallback(() => {
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
        setMicrophonesKnown(devices.some((d) => d.kind === 'audioinput' && d.label));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) {
      setMicrophoneDialogOpen(false);
      return;
    }
    refreshMicrophones();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicrophones);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMicrophones);
  }, [open, refreshMicrophones]);

  useEffect(() => {
    if (!open || activeTab !== 'settings' || !capturingTarget) {
      if (capturingTarget) setCapturingTarget(null);
      if (!open || activeTab !== 'settings') setShortcutError(null);
      return;
    }
    const pressed = new Map<string, number>();
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturingTarget(null);
        return;
      }
      addCapturedKey(pressed, formatKeyName(e), e.timeStamp);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!pressed.size) return;
      e.preventDefault();
      e.stopPropagation();
      const combo = [...pressed.keys()];
      const conflict = findShortcutConflict(settings.shortcuts, capturingTarget, combo, window.yapyap?.platform);
      setCapturingTarget(null);
      if (window.yapyap?.platform === 'win32' && reservedShortcut(combo)) {
        setShortcutError({ target: capturingTarget, combo, reason: 'reserved' });
        return;
      }
      if (conflict) {
        setShortcutError({ target: capturingTarget, combo, reason: 'used' });
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
                                      {rowError?.reason === 'reserved'
                                        ? 'This shortcut is reserved by the system'
                                        : 'This shortcut is already in use'}
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
                    {(() => {
                      const holdCombo = pauseHoldCombo(settings.shortcuts);
                      return holdCombo && <PauseShortcutRow combo={holdCombo} />;
                    })()}
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
                          className="inline-flex items-center gap-2 h-9 px-[11px] rounded-[11px] whitespace-nowrap bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-w-[210px]"
                        >
                          <span className="truncate">
                            {settings.translationTargets.join(', ') || 'Select languages'}
                          </span>
                          <ChevronRight className="w-4 h-4 shrink-0 -mr-0.5 text-[var(--text-secondary)]" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="py-2.5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                            Languages I speak
                          </div>
                          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                            The languages you dictate in, so speech stays in the language you spoke.
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Edit languages I speak: ${settings.spokenLanguages.join(', ') || 'Auto-detect'}`}
                          aria-haspopup="dialog"
                          onClick={() => setLanguageDialog('spoken')}
                          className="inline-flex items-center gap-2 h-9 px-[11px] rounded-[11px] whitespace-nowrap bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-w-[210px]"
                        >
                          <span className="truncate">{settings.spokenLanguages.join(', ') || 'Auto-detect'}</span>
                          <ChevronRight className="w-4 h-4 shrink-0 -mr-0.5 text-[var(--text-secondary)]" aria-hidden="true" />
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
                          className="inline-flex items-center gap-2 h-9 px-[11px] rounded-[11px] whitespace-nowrap bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        >
                          Select language variants
                          <ChevronRight className="w-4 h-4 shrink-0 -mr-0.5 text-[var(--text-secondary)]" aria-hidden="true" />
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
                      <button
                        type="button"
                        aria-label={`Change microphone: ${microphoneLabel}`}
                        aria-haspopup="dialog"
                        onClick={() => setMicrophoneDialogOpen(true)}
                        className="inline-flex items-center gap-2 h-9 px-[11px] rounded-[11px] whitespace-nowrap bg-[var(--bg-input)] border border-[var(--border-strong)] text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-w-[230px]"
                      >
                        {microphoneMissing && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-[#dc2626]" aria-hidden="true" />}
                        <span className="truncate">{microphoneLabel}</span>
                        <ChevronRight className="w-4 h-4 shrink-0 -mr-0.5 text-[var(--text-secondary)]" aria-hidden="true" />
                      </button>
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

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Strong noise reduction
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Removes voices, traffic and other background noise. Use it in noisy places; it can lower accuracy in quiet ones.
                        </p>
                      </div>
                      <Toggle
                        label="Strong noise reduction"
                        checked={settings.strongNoiseReduction}
                        onChange={(val) => onUpdateSettings({ strongNoiseReduction: val })}
                      />
                    </div>
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

                    <div className="py-2.5">
                      <div id="yy-cleanup-heading" className="text-[13.5px] font-medium text-[var(--text-primary)]">
                        AI cleanup
                      </div>
                      <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 mb-2">
                        How much your AI provider edits a dictation. You can undo it for any dictation in History.
                      </p>
                      <div className="yy-style-choices yy-cleanup-choices" role="radiogroup" aria-labelledby="yy-cleanup-heading">
                        {CLEANUP_CHOICES.map((choice) => {
                          const checked = choice.id === 'none'
                            ? !settings.smartCleanup
                            : settings.smartCleanup && settings.cleanupLevel === choice.id;
                          return (
                            <label key={choice.id} className="yy-style-choice" data-checked={checked || undefined}>
                              <input
                                type="radio"
                                name="yy-cleanup-level"
                                className="sr-only"
                                checked={checked}
                                onChange={() => onUpdateSettings(choice.id === 'none'
                                  ? { smartCleanup: false }
                                  : { smartCleanup: true, cleanupLevel: choice.id })}
                              />
                              <strong>{choice.label}</strong>
                              <span>{choice.description}</span>
                            </label>
                          );
                        })}
                      </div>
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

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                          Keep result on clipboard
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          Leave each dictation or answer copied. Off keeps your clipboard as it was.
                        </p>
                      </div>
                      <Toggle
                        label="Keep result on clipboard"
                        checked={settings.keepOnClipboard}
                        onChange={(val) => onUpdateSettings({ keepOnClipboard: val })}
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
                      Yap Yap learns your tone per category through your configured AI provider. Casing and punctuation are learned only from your own writing: transcripts you correct in History, fixes you make right after a paste, and, with context awareness on, text you already wrote in the app. Short excerpts of corrected transcripts guide future formatting in the same category.
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

                <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-subtle)] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-medium">Learn from my edits</h3>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      When you fix casing, punctuation, or a misspelled name right after Yap Yap pastes, it learns your style and adds the name to your dictionary. Turn this off to keep Yap Yap from reading the text after it pastes.
                    </p>
                  </div>
                  <Toggle label="Learn from my edits" checked={settings.learnFromEdits} onChange={(learnFromEdits) => onUpdateSettings({ learnFromEdits })} />
                </div>

                {/* Rules apply even with personalization off, so they stay editable. */}
                {(
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

                {settings.personalizationEnabled && (
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--border-subtle)] px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">Writing style</h3>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">{stylesSummary}</p>
                    </div>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setStylesOpen(true)}
                      className="inline-flex h-8 shrink-0 items-center rounded-full border border-[var(--border-strong)] px-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      Choose
                    </button>
                  </div>
                )}

                {settings.personalizationEnabled && (
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--border-subtle)] px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">Apps and sites</h3>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">{sourcesSummary}</p>
                    </div>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setSourcesOpen(true)}
                      className="inline-flex h-8 shrink-0 items-center rounded-full border border-[var(--border-strong)] px-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      {destinations.length ? 'Manage' : 'Add'}
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
                                  {item.tone}{item.phrasing && ` · ${item.phrasing}`}
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
                        v{version} · Yap Yap Desktop
                      </div>
                    </div>
                    {window.yapyap?.updates && (
                      <button
                        type="button"
                        onClick={() => setUpdateDialogOpen(true)}
                        className="px-4 py-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-card-solid)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] transition-colors"
                      >
                        Check for updates
                      </button>
                    )}
                  </div>
                  {updateDialogOpen && <UpdateDialog onClose={() => setUpdateDialogOpen(false)} />}

                  <a
                    href={siteLinks.privacy}
                    target="_blank"
                    rel="noreferrer"
                    className="-mx-3 px-3 py-2 flex items-center justify-between gap-4 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <span className="text-[14px] font-medium text-[var(--text-primary)]">
                      Privacy policy
                    </span>
                    <ArrowUpRight size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                  </a>
                </div>
              </div>
            )}

            {/* TAB 5: HELP */}
            {activeTab === 'help' && (
              <div className="space-y-5">
                <h2 className="text-[22px] font-semibold text-[var(--text-primary)]">
                  Help
                </h2>
                <div className="-mx-3">
                  {[
                    { href: siteLinks.setupGuide, title: 'Setup guide', detail: 'Get each API key, plus prices and free plans.' },
                    { href: siteLinks.bestSetups, title: 'Best setups', detail: 'Which providers to combine, from free to best quality.' },
                    { href: siteLinks.home, title: 'Yap Yap website', detail: 'Features, FAQs, and downloads.' },
                    { href: feedbackUrl, title: 'Report a bug or suggest a feature', detail: 'Opens a short form on GitHub. You’ll need a GitHub account.' },
                  ].map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-[var(--text-primary)]">{link.title}</span>
                        <span className="block text-[13px] text-[var(--text-secondary)] mt-0.5">{link.detail}</span>
                      </span>
                      <ArrowUpRight size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                    </a>
                  ))}
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
      {microphoneDialogOpen && (
        <MicrophoneDialog
          microphones={microphones}
          devicesKnown={microphonesKnown}
          value={settings.microphoneId}
          strongNoiseReduction={settings.strongNoiseReduction}
          onChange={(microphoneId) => onUpdateSettings({ microphoneId })}
          onListening={refreshMicrophones}
          onClose={() => setMicrophoneDialogOpen(false)}
        />
      )}
      {languageDialog === 'spoken' && (
        <SpokenLanguagesDialog
          languages={settings.spokenLanguages}
          onChange={(spokenLanguages) => onUpdateSettings({ spokenLanguages })}
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
      {open && activeTab === 'personalization' && stylesOpen && (
        <StartingStylesDialog
          corrections={settings.styleCorrections}
          defaultStyle={settings.defaultStyle}
          active={settings.personalizationEnabled && settings.smartCleanup}
          onChange={(styleCorrections) => onUpdateSettings({ styleCorrections })}
          onDefaultChange={(defaultStyle) => onUpdateSettings({ defaultStyle })}
          onClose={() => setStylesOpen(false)}
        />
      )}
      {open && activeTab === 'personalization' && sourcesOpen && (
        <SourceCategoriesDialog
          destinations={destinations}
          choices={settings.sourceCategories as Record<string, SourceChoice>}
          onChange={(sourceCategories) => onUpdateSettings({ sourceCategories })}
          onClose={() => setSourcesOpen(false)}
        />
      )}
      {open && activeTab === 'personalization' && preferencesEditorOpen && (
        <PersonalizationEditor
          preferences={settings.writingPreferences}
          profiles={withPickedStyles(stats.categoryBreakdown, settings.styleCorrections)}
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
