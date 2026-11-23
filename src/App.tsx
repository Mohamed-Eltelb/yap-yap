import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pauseHoldCombo } from '../electron/shortcutBindings';
import type { DictationContext, SelectedText } from '../electron/dictationContext';
import { DictionaryView, type ImportedWord } from './components/DictionaryView';
import { SnippetsView } from './components/SnippetsView';
import { Onboarding } from './components/Onboarding';
import { shouldShowOnboarding } from './services/onboarding';
import { DictationHud, HudState, PAUSE_TIP_MS } from './components/DictationHud';
import { HistoryView } from './components/HistoryView';
import { HomeView } from './components/HomeView';
import { SettingsModal } from './components/SettingsModal';
import { ImportDialog } from './components/ImportDialog';
import type { OtherAppData } from '../electron/otherApps';
import { applyImport, undoImport, type ImportPlan, type ImportReceipt, type ImportSelection } from './services/otherAppImport';
import { ShareModal } from './components/ShareModal';
import { Sidebar } from './components/Sidebar';
import { getPreferredLanguageVariants } from './data/languages';
import { DEFAULT_SETTINGS } from './data/seedData';
import { PROVIDER_CATALOG, PROVIDER_ORDER, createDefaultProviders, isProviderConfigured } from './services/providers/catalog';
import { assignHistoryIds, parseHistoryImport, skipDuplicateHistory } from './services/historyImport';
import { extractCorrections } from '../electron/pasteCorrections';
import { applyDictionaryReplacements, expandSnippets, snippetsSaidIn, snippetsFromCleanup, snippetTriggerKey, wholeSnippet, mergeImportedWords, applyStyleCorrections, stylesForCleanup, type WritingProfile, buildSourceCategories, categoryForDestination, dictionaryWordsFor, DONT_LEARN, forgetRetainedStyles, learnableSource, listDestinations, type SourceChoice, forgetWritingStyles, isStyleEdit, restoreRetainedStyles, retainRemovedStyles, toRetainedStyle, userWrittenText, withRetainedStyles, restoreWritingStyles, samplesSinceCorrection, type ForgottenStyles, destinationKey, fitToSurroundingText } from './services/personalization';
import {
  detectWritingStyle,
  processTranscriptWithLlm,
  transcribeAudio,
} from './services/providers/engine';
import {
  classifyTranscriptCategory,
  computeInsights,
  countWords,
  extractAutoDictionaryWords,
  filterByRetention,
} from './services/stats';
import {
  PersistedAppState,
  getInitialState,
  loadPersistedState,
  savePersistedState,
  loadHistoryAudio,
} from './services/storage';
import {
  ActiveNav,
  DictationMode,
  HistoryItem,
  ProviderConfig,
  ProviderId,
  SettingsModalTab,
  SettingsState,
  WritingSample,
} from './types/app';
import {
  RecorderSession,
  dataUrlToBlob,
  startAudioRecording,
} from './utils/audioRecorder';
import { playInteractionSound } from './utils/sounds';
import { deliverDictationResult } from './utils/dictationResult';
import { answerAsPlainText } from './utils/answerText';
import { createHudMouseGate } from './utils/hudMouseGate';

function normalizeKey(e: KeyboardEvent): string {
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

function comboMatches(pressed: Set<string>, combo: string[]): boolean {
  if (combo.length === 0) return false;
  if (pressed.size !== combo.length) return false;
  return combo.every((k) => pressed.has(k));
}

const modifierOnlyKey = /^(?:(?:Left |Right )?(?:Alt|Shift|Ctrl)|Control|Cmd|Meta|Command)$/;

/** What setup's Try step draws itself. Errors and notices still float, so a failed try is never silent. */
const SETUP_MIRRORED_STATUSES: ReadonlySet<HudState['status']> = new Set(['armed', 'recording', 'processing', 'result']);

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.classList.contains('hide')) return;
  requestAnimationFrame(() => {
    splash.classList.add('hide');
    window.setTimeout(() => splash.remove(), 250);
  });
}

/** The History fields that keep what an Ask anything question was about. */
function askSelection(mode: DictationMode, selection?: SelectedText): Pick<HistoryItem, 'selectedText' | 'selectionTruncated'> {
  return mode === 'ask' && selection
    ? { selectedText: selection.text, selectionTruncated: selection.truncated || undefined }
    : { selectedText: undefined, selectionTruncated: undefined };
}

/** The selection a History item's question was about, so a retry asks about the same text. */
function historySelection(item: HistoryItem): SelectedText | undefined {
  return item.mode === 'ask' && item.selectedText ? { text: item.selectedText, truncated: item.selectionTruncated === true } : undefined;
}

export function App() {
  const [appState, setAppState] = useState<PersistedAppState>(() => getInitialState());
  const [hydrated, setHydrated] = useState(false);

  const [activeNav, setActiveNav] = useState<ActiveNav>('home');
  const [modalOpen, setModalOpen] = useState(false);
  /** True while a Settings shortcut field records keys; the shortcuts are ignored then. */
  const capturingShortcut = useRef(false);
  const setCapturingShortcut = useCallback((capturing: boolean) => { capturingShortcut.current = capturing; }, []);
  const [showHudTargetSettings, setShowHudTargetSettings] = useState(false);
  const [modalTab, setModalTab] = useState<SettingsModalTab>('providers');
  const [shareOpen, setShareOpen] = useState(false);
  /** Wispr Flow and Typeless data on this computer that can be imported. */
  const [otherApps, setOtherApps] = useState<OtherAppData[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  /** First-run setup, shown over the app. */
  const [setupOpen, setSetupOpen] = useState(false);
  // Setup's Try step draws the pill and the result itself, so the floating ones stay hidden meanwhile.
  const [setupTrying, setSetupTrying] = useState(false);
  const setupTryingRef = useRef(false);
  setupTryingRef.current = setupOpen && setupTrying;
  const setupOpenRef = useRef(false);
  setupOpenRef.current = setupOpen;
  const lastImportRef = useRef<{ receipt: ImportReceipt; after: Pick<PersistedAppState, 'dictionary' | 'snippets'> } | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [globalModifiers, setGlobalModifiers] = useState(false);

  const [hud, setHud] = useState<HudState>({
    status: 'idle',
    mode: 'dictate',
    levels: Array(20).fill(0.1),
  });

  const recorderRef = useRef<RecorderSession | null>(null);
  const recorderStartRef = useRef<symbol | null>(null);
  const mutedForRecording = useRef(false);
  const muteTimer = useRef<number | null>(null);
  const lastTriggerTimeRef = useRef<number>(0);
  const processingRunRef = useRef(0);
  const busyNoticeTimer = useRef<number | undefined>(undefined);
  // The pause tip shows on the first recording after the app starts, then for a few seconds only.
  const pauseTipShown = useRef(false);
  const pauseTipTimer = useRef<number | undefined>(undefined);
  const hudRef = useRef<HudState>(hud);
  const openedTargetsDuringRecording = useRef(false);
  hudRef.current = hud;

  const isHudRoute =
    typeof window !== 'undefined' && window.location.hash === '#/hud';
  const useFloatingHud = Boolean(window.yapyap?.isElectron && appState.settings.floatingHud);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Load persisted state on boot
  useEffect(() => {
    if (isHudRoute) return;
    loadPersistedState().then((loaded) => {
      const history = filterByRetention(loaded.history, loaded.settings.historyRetention);
      setAppState({
        ...loaded,
        history,
        // Dictations that expired while the app was closed keep their learned style.
        settings: { ...loaded.settings, retainedStyleSamples: retainRemovedStyles(loaded.history, history, loaded.settings.retainedStyleSamples) },
      });
      // Once shown, setup stays until finished or skipped, even after a key is added in it.
      if (shouldShowOnboarding(loaded)) setSetupOpen(true);
      setHydrated(true);
    });
  }, [isHudRoute]);

  // Persist on changes
  useEffect(() => {
    if (!hydrated || isHudRoute) return;
    void savePersistedState(appState);
  }, [appState, hydrated, isHudRoute]);

  // Apply light/dark theme class and listen for live OS system theme changes
  useEffect(() => {
    // Until saved settings load, keep the theme the splash already picked.
    if (!isHudRoute && !hydrated) return;
    const mode = isHudRoute ? hud.appearance ?? 'system' : appState.settings.appearance;
    if (!isHudRoute) {
      window.yapyap?.setAppearance?.(mode);
      try {
        localStorage.setItem('yapyap_appearance', mode);
      } catch {
        // ignore
      }
    }
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const isDark = mode === 'dark' || (mode === 'system' && Boolean(mql?.matches));
      const root = document.documentElement;
      if (root.classList.contains('dark') === isDark) return;
      // Pause color transitions so the whole UI switches in one frame
      // instead of each element fading on its own timing.
      root.classList.add('theme-switching');
      root.classList.toggle('dark', isDark);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => root.classList.remove('theme-switching'));
      });
    };

    applyTheme();
    if (!isHudRoute) hideSplash();
    if (mode === 'system' && mql?.addEventListener) {
      mql.addEventListener('change', applyTheme);
      return () => mql.removeEventListener('change', applyTheme);
    }
  }, [appState.settings.appearance, hud.appearance, hydrated, isHudRoute]);

  // The HUD window is larger than what it draws, so it only takes the mouse
  // while the pointer is over the HUD itself.
  useEffect(() => {
    if (!isHudRoute) return;
    const gate = createHudMouseGate((ignore) => window.yapyap?.setHudIgnoreMouse?.(ignore));
    const onMove = (event: MouseEvent) =>
      gate.move(event.target instanceof Element && event.target.closest('.yy-hud') !== null);
    const onLeave = () => gate.leave();
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    // Each time the HUD shows again, Electron starts it letting the mouse through.
    const unsubShown = window.yapyap?.onHudShown?.(gate.reset);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      unsubShown?.();
    };
  }, [isHudRoute]);

  // Sync Electron global shortcuts + login item
  useEffect(() => {
    if (!hydrated || isHudRoute) return;
    void window.yapyap?.updateShortcuts?.(appState.settings.shortcuts)
      .then(setGlobalModifiers, () => setGlobalModifiers(false));
  }, [appState.settings.shortcuts, hydrated, isHudRoute]);

  useEffect(() => {
    if (!hydrated || isHudRoute) return;
    void window.yapyap?.setLaunchAtLogin?.(appState.settings.launchAtLogin)
      .catch(() => showToast('Could not update launch at login.'));
  }, [appState.settings.launchAtLogin, hydrated, isHudRoute, showToast]);

  // Subscribe before telling Electron it can send the current HUD state.
  useEffect(() => {
    if (!isHudRoute) return;
    const unsub = window.yapyap?.onHudState?.((nextState) => {
      if (nextState && typeof nextState === 'object') {
        setHud(nextState as HudState);
      }
    });
    window.yapyap?.hudReady?.();
    return unsub;
  }, [isHudRoute]);

  // Forward HUD state from main window to external Electron HUD overlay
  useEffect(() => {
    if (isHudRoute) return;
    const mirroredBySetup = setupOpen && setupTrying && SETUP_MIRRORED_STATUSES.has(hud.status);
    const visible = hud.status !== 'idle' && useFloatingHud && !mirroredBySetup;
    window.yapyap?.toggleHud?.(visible, {
      ...hud,
      targets: appState.settings.translationTargets,
      appearance: appState.settings.appearance,
    });
  }, [hud, isHudRoute, useFloatingHud, setupOpen, setupTrying, appState.settings.translationTargets, appState.settings.appearance]);

  const updateSettings = useCallback((patch: Partial<SettingsState>) => {
    setAppState((prev) => {
      const nextSettings = { ...prev.settings, ...patch };
      const nextHistory =
        patch.historyRetention !== undefined
          ? filterByRetention(prev.history, patch.historyRetention)
          : prev.history;
      return {
        ...prev,
        settings: nextSettings,
        history: nextHistory,
      };
    });
  }, []);

  /** Forgets the learned style for some categories, or all, and returns what it removed. */
  const forgetLearnedStyle = useCallback((categories?: string[]): ForgottenStyles => {
    // Filled from the state the update actually applies to, so Undo puts back exactly what was
    // removed, even if a new style sample was saved in between. React runs the update before
    // the page renders again, and Undo can only be pressed after that.
    const forgotten: ForgottenStyles = { samples: {}, styleCorrections: {} };
    setAppState((prev) => {
      const next = forgetWritingStyles(prev.history, prev.settings.styleCorrections, categories);
      const retained = forgetRetainedStyles(prev.settings.retainedStyleSamples, categories);
      Object.assign(forgotten, next.forgotten, { retained: retained.forgotten });
      return {
        ...prev,
        history: next.history,
        settings: { ...prev.settings, styleCorrections: next.styleCorrections, retainedStyleSamples: retained.retained },
      };
    });
    return forgotten;
  }, []);

  const restoreLearnedStyle = useCallback((forgotten: ForgottenStyles) => {
    setAppState((prev) => {
      const next = restoreWritingStyles(prev.history, prev.settings.styleCorrections, forgotten);
      return {
        ...prev,
        history: next.history,
        settings: {
          ...prev.settings,
          styleCorrections: next.styleCorrections,
          retainedStyleSamples: restoreRetainedStyles(prev.settings.retainedStyleSamples, forgotten.retained),
        },
      };
    });
  }, []);

  const updateProvider = useCallback(
    (id: ProviderId, patch: Partial<ProviderConfig>) => {
      setAppState((prev) => {
        const updatedProvider = { ...prev.providers[id], ...patch };
        const nextProviders = {
          ...prev.providers,
          [id]: updatedProvider,
        };

        let nextSettings = prev.settings;
        if (patch.status === 'connected') {
          const meta = PROVIDER_CATALOG[id];
          const currStt = prev.settings.activeSttProvider;
          const currSttNeedsSetup = !isProviderConfigured(prev.providers[currStt]);
          const currLlm = prev.settings.activeLlmProvider;
          const currLlmNeedsSetup =
            currLlm !== 'none' && !isProviderConfigured(prev.providers[currLlm]);

          nextSettings = {
            ...prev.settings,
            activeSttProvider:
              meta.supportsStt && currSttNeedsSetup ? id : prev.settings.activeSttProvider,
            activeLlmProvider:
              meta.supportsLlm && currLlmNeedsSetup ? id : prev.settings.activeLlmProvider,
          };
        }

        return {
          ...prev,
          providers: nextProviders,
          settings: nextSettings,
        };
      });
    },
    []
  );

  const removeProvider = useCallback((id: ProviderId) => {
    setAppState((prev) => {
      const providers = { ...prev.providers, [id]: createDefaultProviders()[id] };
      const settings = { ...prev.settings };
      const remaining = PROVIDER_ORDER.filter((candidate) => isProviderConfigured(providers[candidate]));
      if (settings.activeSttProvider === id) {
        settings.activeSttProvider = remaining.find((candidate) => PROVIDER_CATALOG[candidate].supportsStt)
          ?? DEFAULT_SETTINGS.activeSttProvider;
      }
      if (settings.activeLlmProvider === id) {
        settings.activeLlmProvider = remaining.find((candidate) => PROVIDER_CATALOG[candidate].supportsLlm)
          ?? DEFAULT_SETTINGS.activeLlmProvider;
      }

      return { ...prev, providers, settings };
    });
  }, []);

  // Silent and cancelled recordings stay in History but never count as dictation.
  const completedHistory = useMemo(() => appState.history.filter((item) => !item.outcome), [appState.history]);
  // Learning also reads the style of dictations that have left History.
  const learningHistory = useMemo(
    () => withRetainedStyles(completedHistory, appState.settings.retainedStyleSamples),
    [completedHistory, appState.settings.retainedStyleSamples]
  );

  // Corrections the user made to learned styles replace them everywhere: cleanup, Insights, Settings.
  const stats = useMemo(() => {
    const insights = computeInsights(completedHistory, new Date(), learningHistory);
    return { ...insights, categoryBreakdown: applyStyleCorrections(insights.categoryBreakdown, appState.settings.styleCorrections) };
  }, [completedHistory, learningHistory, appState.settings.styleCorrections]);

  // Dictations made since each correction, so the editor can suggest updating one that no longer fits.
  const recentStyleSamples = useMemo(
    () => samplesSinceCorrection(learningHistory, appState.settings.styleCorrections),
    [learningHistory, appState.settings.styleCorrections]
  );

  const learnedSources = useMemo(() => buildSourceCategories(learningHistory), [learningHistory]);
  // Apps and sites for the list in Personalization, with what Yap Yap would pick for each.
  const destinations = useMemo(
    () => listDestinations(completedHistory, learnedSources, appState.settings.sourceCategories as Record<string, SourceChoice>),
    [completedHistory, learnedSources, appState.settings.sourceCategories]
  );

  // Whatever removes dictations from History (delete, clear, retention), their learned style stays.
  const previousHistoryRef = useRef<HistoryItem[] | null>(null);
  useEffect(() => {
    if (!hydrated || isHudRoute) return;
    const previous = previousHistoryRef.current;
    previousHistoryRef.current = appState.history;
    if (!previous || previous === appState.history) return;
    if (retainRemovedStyles(previous, appState.history, []).length === 0) return;
    setAppState((prev) => ({
      ...prev,
      settings: { ...prev.settings, retainedStyleSamples: retainRemovedStyles(previous, prev.history, prev.settings.retainedStyleSamples) },
    }));
  }, [appState.history, hydrated, isHudRoute]);

  const restoreAudioMute = useCallback(() => {
    if (muteTimer.current !== null) {
      window.clearTimeout(muteTimer.current);
      muteTimer.current = null;
    }
    if (!mutedForRecording.current) return;
    mutedForRecording.current = false;
    void window.yapyap?.setSystemMute(false).catch(console.warn);
  }, []);

  /** What Yap Yap pasted lately, so its own output at the caret is never learned as the user's writing. */
  const ownDeliveriesRef = useRef<string[]>([]);

  const processAudioPipeline = useCallback(
    async (
      audioBlob: Blob,
      durationMs: number,
      mode: DictationMode,
      audioDataUrl?: string,
      audioMimeType?: string,
      existingItemId?: string,
      targetLanguage?: string,
      allowAutoPaste = true,
      destinationProbe?: Promise<DictationContext | undefined>,
      /** Ask anything: the text selected when the shortcut was pressed. Read once, so a retry asks about the same text. */
      selectionProbe?: Promise<SelectedText | undefined>,
    ) => {
      retryAudioRef.current = null;
      const autoPaste = mode !== 'ask' && allowAutoPaste && appState.settings.autoPaste;
      const keepOnClipboard = appState.settings.keepOnClipboard;
      if (autoPaste) window.yapyap?.preparePaste?.();
      let sttProviderId = appState.settings.activeSttProvider;
      let sttProvider = appState.providers[sttProviderId];
      if (
        PROVIDER_CATALOG[sttProviderId].requiresKey &&
        !sttProvider.apiKey.trim()
      ) {
        const fallbackStt = (Object.values(appState.providers) as ProviderConfig[]).find(
          (p) =>
            PROVIDER_CATALOG[p.id].supportsStt && isProviderConfigured(p)
        );
        if (fallbackStt) {
          sttProviderId = fallbackStt.id;
          sttProvider = fallbackStt;
        }
      }

      const llmSelection = appState.settings.activeLlmProvider;
      // Cancelling while this runs starts a new run, and this one then stops without a trace.
      const run = ++processingRunRef.current;
      const dropped = () => run !== processingRunRef.current;
      // Kept so a dictation cancelled while it is processing can be brought back with Undo.
      processingAudioRef.current = Promise.resolve([audioBlob, durationMs, mode, audioDataUrl, audioMimeType, existingItemId, targetLanguage, allowAutoPaste, undefined, selectionProbe]);

      setHud({
        status: 'processing',
        mode,
        levels: Array(20).fill(0.1),
      });

      try {
        const dictWords = dictionaryWordsFor(appState.dictionary, appState.settings.personalizationEnabled);
        const rawText = await transcribeAudio(audioBlob, sttProvider, {
          dictionaryWords: dictWords,
          spokenLanguages: appState.settings.spokenLanguages,
          languageVariants: getPreferredLanguageVariants(appState.settings.languageVariants),
        });
        if (dropped()) return;

        if (!rawText) {
          playInteractionSound('error', appState.settings.interactionSounds);
          setHud({
            status: 'error',
            mode,
            levels: [],
            errorText: 'No speech was detected in the recording.',
          });
          setAppState((prev) => existingItemId ? {
            ...prev,
            history: prev.history.map((h) => h.id === existingItemId && !h.text.trim() ? { ...h, outcome: 'silent' as const } : h),
          } : {
            ...prev,
            history: filterByRetention([{
              id: `h-${Date.now()}`,
              createdAt: new Date().toISOString(),
              mode,
              rawText: '',
              text: '',
              targetLanguage: mode === 'translate' ? targetLanguage : undefined,
              durationMs,
              wordCount: 0,
              wpm: 0,
              providerId: sttProviderId,
              model: sttProvider.sttModel,
              audioDataUrl,
              audioMimeType,
              outcome: 'silent' as const,
            }, ...prev.history], prev.settings.historyRetention),
          });
          return;
        }

        // App and site always set the tone. Text near the caret stays on the device unless
        // context awareness is on.
        const destination = mode === 'dictate' || mode === 'translate' ? await destinationProbe : undefined;
        const selection = mode === 'ask' ? await selectionProbe : undefined;
        if (dropped()) return;
        const location = destination && { application: destination.application, domain: destination.domain };
        // Style learning covers dictation only.
        // A retry has no live destination, so it keeps the one the dictation went to.
        const retried = existingItemId ? appState.history.find((item) => item.id === existingItemId) : undefined;
        const source = mode === 'dictate' && appState.settings.personalizationEnabled
          ? destinationKey(location) ?? learnableSource(retried?.writingSource)
          : undefined;
        const shareText = appState.settings.contextAwareness;

        let finalText = rawText;
        let answer: string | undefined;
        let searchedWeb: boolean | undefined;
        let learnStyle: (() => Promise<WritingSample | undefined>) | undefined;
        /** Learns from the casing and punctuation the user fixes in the pasted text. */
        let learnFromEdit: ((edited: string, pasted: string) => Promise<WritingSample | undefined>) | undefined;
        let usedProviderId: ProviderId = sttProviderId;
        let usedModel = sttProvider.sttModel;

        // Saying only a snippet's trigger pastes its text as saved, with no cleanup to change it.
        const onlySnippet = mode === 'dictate' ? wholeSnippet(rawText, appState.snippets, appState.dictionary) : undefined;
        // Which snippets were said is read from the recognizer's text: punctuation inside a trigger
        // ("My address: 12 October") means it was not meant, and cleanup may move that punctuation.
        const saidSnippets = mode === 'dictate' ? snippetsSaidIn(rawText, appState.snippets, appState.dictionary) : [];

        const needsLlm =
          mode === 'translate' ||
          mode === 'ask' ||
          (mode === 'dictate' && appState.settings.smartCleanup && !onlySnippet);

        if (needsLlm && llmSelection !== 'none') {
          let llmProvider = appState.providers[llmSelection];
          let llmMeta = PROVIDER_CATALOG[llmSelection];
          let hasLlmKey =
            llmProvider.apiKey.trim().length > 0 || !llmMeta.requiresKey;

          if (!hasLlmKey) {
            const fallbackLlm = (
              Object.values(appState.providers) as ProviderConfig[]
            ).find(
              (p) =>
                PROVIDER_CATALOG[p.id].supportsLlm && isProviderConfigured(p)
            );
            if (fallbackLlm) {
              llmProvider = fallbackLlm;
              llmMeta = PROVIDER_CATALOG[fallbackLlm.id];
              hasLlmKey = true;
            }
          }

          if (hasLlmKey) {
            // The category comes from the app or domain when known, so cleanup needs no
            // classification round trip. Otherwise the cleanup model picks among all profiles.
            let writingStyles: WritingProfile[] | undefined;
            let knownCategory: string | undefined;
            if (mode === 'dictate' && appState.settings.personalizationEnabled) {
              // The user's choice for this app or site wins. After it, only the built-in rules (or the
              // retried item's own category) override the model; a learned guess stays open to correction.
              const choice = source ? appState.settings.sourceCategories[source] : undefined;
              const chosenCategory = choice && choice !== DONT_LEARN ? choice : undefined;
              const fixedCategory = chosenCategory ?? categoryForDestination(location) ?? retried?.writingSample?.category;
              knownCategory = fixedCategory ?? (source ? learnedSources.get(source) : undefined);
              writingStyles = knownCategory
                ? stylesForCleanup(stats.categoryBreakdown, appState.settings.styleCorrections, { category: knownCategory, defaultStyle: appState.settings.defaultStyle })
                : stylesForCleanup(stats.categoryBreakdown, appState.settings.styleCorrections, { defaultStyle: appState.settings.defaultStyle });
              const styleProvider = llmProvider;
              // Text the user wrote before the caret, without Yap Yap's own earlier pastes.
              const existingWriting = shareText
                ? userWrittenText(destination?.textBefore, [
                    ...ownDeliveriesRef.current,
                    ...appState.history.slice(0, 30).map((item) => item.text),
                  ])
                : undefined;
              // "Don't learn here": the dictation is still cleaned up, but teaches nothing.
              if (choice !== DONT_LEARN) learnStyle = () => detectWritingStyle(rawText, styleProvider, {
                category: fixedCategory,
                destination: location,
                existingWriting,
              }).then((sample) => sample && existingWriting ? { ...sample, fromUserText: true } : sample);
              if (choice !== DONT_LEARN) learnFromEdit = (edited, pasted) => detectWritingStyle(edited, styleProvider, {
                category: fixedCategory,
                destination: location,
                before: pasted,
              }).then((sample) => sample && { ...sample, fromUserText: true, fromEdit: true });
            }
            const processed = await processTranscriptWithLlm(
              rawText,
              mode,
              llmProvider,
              {
                targetLanguages: appState.settings.translationTargets,
                targetLanguage,
                dictionaryWords: dictWords,
                smartCleanup: appState.settings.smartCleanup,
                cleanupLevel: appState.settings.cleanupLevel,
                writingStyles,
                // Rules are the user's own instructions, so they apply even with learning off.
                writingPreferences: mode === 'dictate' ? appState.settings.writingPreferences : undefined,
                // Rules saved for one kind of place apply only when the destination is that kind.
                destinationCategory: knownCategory,
                // Before and after stay separate so the model knows where the caret is.
                // The app and site always shape formatting (an email reads differently from a chat);
                // the text near the caret goes only with context awareness on.
                destination: location && {
                  ...location,
                  textBefore: shareText ? destination.textBefore || undefined : undefined,
                  textAfter: shareText ? destination.textAfter || undefined : undefined,
                },
                // Snippet phrases must survive cleanup to expand. Their saved text is never sent.
                // Spaced out ("my address 12"), so cleanup writes the words, not "address12".
                keepPhrases: saidSnippets.map((snippet) => snippetTriggerKey(snippet.trigger)),
                selection,
                // The Thinking pill says "Searching the web" from the moment the provider starts searching.
                onWebSearch: () => {
                  if (!dropped()) setHud((current) => current.status === 'processing' ? { ...current, searchingWeb: true } : current);
                },
              }
            );
            if (dropped()) return;
            finalText = processed.finalText || rawText;
            answer = processed.answer;
            searchedWeb = processed.searchedWeb;
            if (mode !== 'dictate') {
              usedProviderId = llmProvider.id;
              usedModel = llmProvider.llmModel;
            }
          } else if (mode === 'translate' || mode === 'ask') {
            throw new Error(
              `${llmProvider.name} API key is required for ${
                mode === 'translate' ? 'Translate' : 'Ask anything'
              } mode.`
            );
          }
        } else if ((mode === 'translate' || mode === 'ask') && llmSelection === 'none') {
          throw new Error('Select an AI provider in API Keys to use Translate or Ask anything.');
        }

        // Spellings the user said the recognizer gets wrong, fixed with or without cleanup. Snippets
        // expand last, so nothing rewrites their text.
        let beforeSnippets = finalText;
        let startsWithSnippet = false;
        if (mode === 'dictate') {
          finalText = applyDictionaryReplacements(finalText, appState.dictionary);
          beforeSnippets = finalText;
          const expanded = onlySnippet
            ? { text: onlySnippet.expansion, fired: true, startsWithExpansion: true }
            : expandSnippets(
              finalText,
              // Plus any cleanup wrote plainly that the recognizer wrote in a form the app cannot read.
              [...saidSnippets, ...snippetsFromCleanup(rawText, finalText, appState.snippets, appState.dictionary)],
              appState.dictionary,
              { loose: true },
            );
          finalText = expanded.text;
          startsWithSnippet = expanded.startsWithExpansion;
          // Saved text says nothing about how the user writes here.
          if (expanded.fired) {
            learnStyle = undefined;
            learnFromEdit = undefined;
          }
        }
        // Saved now, with this moment's dictionary and snippets, for "Undo AI edit".
        const plainText = mode === 'dictate' ? withoutAiEdit(rawText) : undefined;
        const category = classifyTranscriptCategory(finalText, mode);
        const words = countWords(finalText);
        const wpm = Math.max(
          1,
          Math.round((countWords(rawText) / Math.max(1000, durationMs)) * 60_000)
        );
        // Ask answers and translations are not the user's words, so only dictation teaches terms.
        const autoWords = mode === 'dictate' ? extractAutoDictionaryWords(beforeSnippets, dictWords) : [];

        const itemId = existingItemId ?? `h-${Date.now()}`;
        if (existingItemId) {
          setAppState((prev) => ({
            ...prev,
            history: prev.history.map((h) =>
              h.id === existingItemId
                ? {
                    ...h,
                    rawText,
                    text: finalText,
                    plainText,
                    aiText: undefined,
                    answer,
                    searchedWeb,
                    ...askSelection(mode, selection),
                    wordCount: words,
                    wpm,
                    providerId: usedProviderId,
                    model: usedModel,
                    category,
                    outcome: undefined,
                    // The text is the model's again, not the user's hand edit.
                    writingCorrection: undefined,
                    writingCorrectedAt: undefined,
                    // A recording first cancelled or silent has no destination yet.
                    writingSource: h.writingSource ?? source,
                  }
                : h
            ),
          }));
        } else {
          const newItem: HistoryItem = {
            id: itemId,
            createdAt: new Date().toISOString(),
            mode,
            rawText,
            text: finalText,
            plainText,
            answer,
            searchedWeb,
            ...askSelection(mode, selection),
            targetLanguage:
              mode === 'translate' ? targetLanguage ?? appState.settings.translationTargets[0] : undefined,
            durationMs,
            wordCount: words,
            wpm,
            providerId: usedProviderId,
            model: usedModel,
            audioDataUrl,
            audioMimeType,
            category,
            writingSource: source,
          };

          setAppState((prev) => {
            const existingSet = new Set(
              prev.dictionary.map((d) => d.word.toLowerCase())
            );
            const newAutoEntries = (prev.settings.personalizationEnabled ? autoWords : [])
              .filter((w) => !existingSet.has(w.toLowerCase()))
              .map((w, idx) => ({
                id: `d-auto-${Date.now()}-${idx}`,
                word: w,
                source: 'auto' as const,
                createdAt: new Date().toISOString(),
              }));

            return {
              ...prev,
              history: filterByRetention([newItem, ...prev.history], prev.settings.historyRetention),
              dictionary:
                newAutoEntries.length > 0
                  ? [...newAutoEntries, ...prev.dictionary]
                  : prev.dictionary,
            };
          });
        }

        // Saves what this dictation taught. A sample read from the user's own writing is never
        // replaced by one read from speech.
        const keepSample = (sample: WritingSample) => setAppState((prev) => {
          if (!prev.settings.personalizationEnabled) return prev;
          const replaces = (current?: WritingSample) => !(current?.fromUserText && !sample.fromUserText);
          // History kept no item (retention "never", or deleted already): keep only the style.
          if (!prev.history.some((h) => h.id === itemId)) {
            const existing = prev.settings.retainedStyleSamples.find((item) => item.id === itemId);
            const retained = replaces(existing?.writingSample)
              ? toRetainedStyle({ id: itemId, createdAt: existing?.createdAt ?? new Date().toISOString(), writingSample: sample })
              : undefined;
            return retained ? {
              ...prev,
              settings: { ...prev.settings, retainedStyleSamples: [retained, ...prev.settings.retainedStyleSamples.filter((item) => item.id !== itemId)] },
            } : prev;
          }
          return {
            ...prev,
            history: prev.history.map((h) => h.id === itemId && !h.writingCorrection && replaces(h.writingSample) ? { ...h, writingSample: sample } : h),
          };
        });

        // Style learning runs beside delivery so it never delays the paste.
        void learnStyle?.().then((sample) => sample && keepSample(sample));

        const desktop = window.yapyap;
        // A snippet at the start keeps its text exactly; fitting would lowercase its first letter.
        // An Ask answer is copied without the Markdown its card renders.
        const delivered = mode === 'dictate' && !startsWithSnippet
          ? fitToSurroundingText(finalText, destination?.textBefore, dictWords)
          : mode === 'ask' ? answerAsPlainText(finalText) : finalText;
        if (dropped()) return;
        ownDeliveriesRef.current = [delivered, ...ownDeliveriesRef.current].slice(0, 30);
        const pasted = await deliverDictationResult(
          mode,
          delivered,
          autoPaste && desktop ? (text) => desktop.pasteText(text, keepOnClipboard) : undefined,
          async (text) => {
            // With "Keep on clipboard" off, the result stays in the HUD card to copy by hand.
            if (!keepOnClipboard) return;
            if (desktop) await desktop.copyText(text);
            else await navigator.clipboard?.writeText(text);
          },
        );

        // Words the user respells in the destination right after the paste join the dictionary.
        if (pasted && mode === 'dictate' && appState.settings.personalizationEnabled && appState.settings.learnFromEdits) {
          void desktop?.watchPasteCorrections?.(delivered).then((edits) => {
            // Fixing casing or punctuation in the pasted text is the clearest sign of how the user
            // writes. Only those edits are sent for learning, not ones that just change words.
            if (edits?.edited && learnFromEdit && isStyleEdit(delivered, edits.edited, edits.words)) {
              void learnFromEdit(edits.edited, delivered).then((sample) => sample && keepSample(sample));
            }
            const words = edits?.words ?? [];
            if (!words.length) return;
            let added: string[] = [];
            setAppState((prev) => {
              const known = new Set(prev.dictionary.map((entry) => entry.word.toLowerCase()));
              added = prev.settings.personalizationEnabled && prev.settings.learnFromEdits ? words.filter((word) => !known.has(word.toLowerCase())) : [];
              if (!added.length) return prev;
              const createdAt = new Date().toISOString();
              return {
                ...prev,
                dictionary: [
                  ...added.map((word, index) => ({ id: `d-fix-${Date.now()}-${index}`, word, source: 'auto' as const, createdAt })),
                  ...prev.dictionary,
                ],
              };
            });
            if (added.length) showToast(`Added to dictionary: ${added.join(', ')}`);
          }).catch(() => undefined);
        }

        playInteractionSound('stop', appState.settings.interactionSounds);

        setHud({
          // Setup's Try step shows the result itself; no card to copy it from.
          status: pasted || setupTryingRef.current ? 'idle' : 'result',
          mode,
          levels: Array(20).fill(0.1),
          resultText: finalText,
          questionText: mode === 'ask' ? rawText : undefined,
          selectionText: mode === 'ask' ? selection?.text : undefined,
          searchedWeb,
        });
      } catch (err) {
        if (dropped()) return;
        retryAudioRef.current = [
          audioBlob, durationMs, mode, audioDataUrl, audioMimeType, existingItemId, targetLanguage, allowAutoPaste, undefined, selectionProbe,
        ];
        playInteractionSound('error', appState.settings.interactionSounds);
        const message = err instanceof Error ? err.message : 'Transcription failed';
        setHud({
          status: 'error',
          mode,
          levels: Array(20).fill(0.1),
          errorText: message,
        });
      }
    },
    [appState.dictionary, appState.history, appState.providers, appState.settings, appState.snippets, learnedSources, stats.categoryBreakdown]
  );

  const retryAudioRef = useRef<Parameters<typeof processAudioPipeline> | null>(null);
  /** Ask anything: the selection read when the shortcut started this recording. */
  const selectionProbeRef = useRef<Promise<SelectedText | undefined> | undefined>(undefined);
  /** The audio of the dictation now processing, for Undo after it is cancelled. */
  const processingAudioRef = useRef<Promise<Parameters<typeof processAudioPipeline> | null> | null>(null);

  const stopAndProcess = useCallback(async () => {
    const session = recorderRef.current;
    if (!session) return;
    recorderRef.current = null;
    restoreAudioMute();
    const { mode: currentMode, targetLanguage } = hudRef.current;
    const allowAutoPaste = !openedTargetsDuringRecording.current || !document.hasFocus();
    const destinationProbe = currentMode === 'dictate' || currentMode === 'translate'
      ? window.yapyap?.captureDictationContext?.().catch(() => undefined) : undefined;
    const selectionProbe = currentMode === 'ask' ? selectionProbeRef.current : undefined;
    selectionProbeRef.current = undefined;
    setHud((current) => ({ ...current, status: 'processing', paused: undefined, pauseTip: undefined }));
    const run = processingRunRef.current;
    const stopping = session.stop();
    const targets = appState.settings.translationTargets;
    const selectedTarget = currentMode === 'translate'
      ? targetLanguage && targets.includes(targetLanguage) ? targetLanguage : targets[0] ?? 'English'
      : undefined;
    // Stopped right after starting (a double tap) or nothing was said: nothing to report.
    const isEmpty = ({ blob, durationMs, heardSpeech }: Awaited<typeof stopping>) =>
      blob.size === 0 || durationMs < 500 || heardSpeech === false;
    processingAudioRef.current = stopping.then((audio): Parameters<typeof processAudioPipeline> | null => isEmpty(audio) ? null
      : [audio.blob, audio.durationMs, currentMode, audio.dataUrl, audio.mimeType, undefined, selectedTarget, allowAutoPaste, undefined, selectionProbe], () => null);
    try {
      const stopped = await stopping;
      const { blob, durationMs, dataUrl, mimeType } = stopped;
      if (run !== processingRunRef.current) return;
      if (isEmpty(stopped)) {
        // Thinking stays up briefly so the box doesn't vanish, then says why nothing came.
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (run !== processingRunRef.current) return;
        setHud({ status: 'notice', mode: currentMode, levels: Array(20).fill(0.1), noticeText: 'No speech detected' });
        setTimeout(() => {
          setHud((current) => current.status === 'notice' ? { status: 'idle', mode: 'dictate', levels: Array(20).fill(0.1) } : current);
        }, 2000);
        return;
      }
      await processAudioPipeline(blob, durationMs, currentMode, dataUrl, mimeType, undefined, selectedTarget, allowAutoPaste, destinationProbe, selectionProbe);
    } catch (err) {
      playInteractionSound('error', appState.settings.interactionSounds);
      setHud({
        status: 'error',
        mode: currentMode,
        levels: Array(20).fill(0.1),
        errorText: err instanceof Error ? err.message : 'Recording stopped unexpectedly',
      });
    }
  }, [appState.settings, processAudioPipeline, restoreAudioMute]);

  // A cancelled recording is kept: it gets a History entry and can be brought back with Undo.
  const cancelledRef = useRef<Promise<Parameters<typeof processAudioPipeline> | null> | null>(null);
  const cancelTimerRef = useRef<number | undefined>(undefined);
  const recordingSinceRef = useRef(0);

  // The HUD runs the Undo countdown itself (pausing while hovered) and dismisses the notice
  // when it ends. This only clears it if the HUD never got to, say in a hidden window.
  const scheduleCancelBackstop = useCallback(() => {
    window.clearTimeout(cancelTimerRef.current);
    cancelTimerRef.current = window.setTimeout(() => {
      cancelledRef.current = null;
      setHud((current) => current.status === 'cancelled' ? { ...current, status: 'idle' } : current);
    }, 60_000);
  }, []);

  // Timers that update the HUD must not fire after the app unmounts (as in tests, where the
  // DOM is torn down and a late setState throws "window is not defined").
  useEffect(() => () => {
    window.clearTimeout(pauseTipTimer.current);
    window.clearTimeout(busyNoticeTimer.current);
    window.clearTimeout(cancelTimerRef.current);
  }, []);

  const cancelRecording = useCallback(() => {
    // Cancelling a dictation still being processed stops it before it pastes; Undo picks it up again.
    if (hudRef.current.status === 'processing') {
      processingRunRef.current += 1;
      const pending = processingAudioRef.current;
      processingAudioRef.current = null;
      if (!pending) {
        setHud({ status: 'idle', mode: 'dictate', levels: Array(20).fill(0.1) });
        return;
      }
      cancelledRef.current = pending;
      setHud({ status: 'cancelled', mode: hudRef.current.mode, levels: Array(20).fill(0.1) });
      scheduleCancelBackstop();
      return;
    }
    retryAudioRef.current = null;
    recorderStartRef.current = null;
    const session = recorderRef.current;
    recorderRef.current = null;
    restoreAudioMute();
    const { mode, targetLanguage } = hudRef.current;
    const selectionProbe = mode === 'ask' ? selectionProbeRef.current : undefined;
    selectionProbeRef.current = undefined;
    // A recording cancelled within a second is a slip, not something worth keeping.
    if (!session || Date.now() - recordingSinceRef.current < 1000) {
      session?.cancel();
      setHud({ status: 'idle', mode: 'dictate', levels: Array(20).fill(0.1) });
      return;
    }
    const allowAutoPaste = !openedTargetsDuringRecording.current || !document.hasFocus();
    const targets = appState.settings.translationTargets;
    const selectedTarget = mode === 'translate'
      ? targetLanguage && targets.includes(targetLanguage) ? targetLanguage : targets[0] ?? 'English'
      : undefined;
    const sttId = appState.settings.activeSttProvider;
    cancelledRef.current = session.stop().then(({ blob, durationMs, dataUrl, mimeType }) => {
      const id = `h-${Date.now()}`;
      setAppState((prev) => ({
        ...prev,
        history: filterByRetention([{
          id,
          createdAt: new Date().toISOString(),
          mode,
          rawText: '',
          text: '',
          targetLanguage: selectedTarget,
          durationMs,
          wordCount: 0,
          wpm: 0,
          providerId: sttId,
          model: prev.providers[sttId].sttModel,
          audioDataUrl: dataUrl,
          audioMimeType: mimeType,
          outcome: 'cancelled' as const,
        }, ...prev.history], prev.settings.historyRetention),
      }));
      return [blob, durationMs, mode, dataUrl, mimeType, id, selectedTarget, allowAutoPaste, undefined, selectionProbe] as Parameters<typeof processAudioPipeline>;
    }).catch(() => null);
    setHud({ status: 'cancelled', mode, levels: Array(20).fill(0.1) });
    scheduleCancelBackstop();
  }, [appState.settings.activeSttProvider, appState.settings.translationTargets, restoreAudioMute, scheduleCancelBackstop]);

  /** Pauses the recording: nothing is captured until it resumes. */
  const pauseRecording = useCallback(() => {
    const session = recorderRef.current;
    if (!session || hudRef.current.status !== 'recording' || hudRef.current.paused) return;
    session.pause();
    setHud((current) => current.status === 'recording' ? { ...current, paused: true, pauseTip: undefined } : current);
  }, []);

  const resumeRecording = useCallback(() => {
    const session = recorderRef.current;
    if (!session || hudRef.current.status !== 'recording' || !hudRef.current.paused) return;
    session.resume();
    setHud((current) => current.status === 'recording' ? { ...current, paused: false } : current);
  }, []);

  const undoCancel = useCallback(async () => {
    const pending = cancelledRef.current;
    if (!pending || hudRef.current.status !== 'cancelled') return;
    cancelledRef.current = null;
    window.clearTimeout(cancelTimerRef.current);
    hudRef.current = { ...hudRef.current, status: 'processing' };
    setHud((current) => ({ ...current, status: 'processing' }));
    const audio = await pending;
    if (!audio) {
      setHud({ status: 'idle', mode: 'dictate', levels: Array(20).fill(0.1) });
      return;
    }
    audio[8] = audio[2] === 'dictate' || audio[2] === 'translate' ? window.yapyap?.captureDictationContext?.().catch(() => undefined) : undefined;
    await processAudioPipeline(...audio);
  }, [processAudioPipeline]);

  const triggerDictationMode = useCallback(
    async (mode: DictationMode) => {
      const now = Date.now();
      // A skipped trigger must not leave the shortcut placeholder on screen.
      const closePlaceholder = () =>
        setHud((current) => current.status === 'armed' ? { status: 'idle', mode: 'dictate', levels: Array(20).fill(0.1) } : current);
      // Guard against duplicate globalShortcut + DOM keydown firing within 350ms
      if (now - lastTriggerTimeRef.current < 350) {
        closePlaceholder();
        return;
      }
      lastTriggerTimeRef.current = now;

      // If already recording, pressing trigger stops and transcribes
      if (hudRef.current.status === 'recording') {
        await stopAndProcess();
        return;
      }
      if (hudRef.current.status === 'processing') return;
      retryAudioRef.current = null;
      cancelledRef.current = null;

      let sttId = appState.settings.activeSttProvider;
      let sttCfg = appState.providers[sttId];
      let sttMeta = PROVIDER_CATALOG[sttId];

      if (sttMeta.requiresKey && !sttCfg.apiKey.trim()) {
        const configuredStt = (
          Object.values(appState.providers) as ProviderConfig[]
        ).find(
          (p) =>
            PROVIDER_CATALOG[p.id].supportsStt && isProviderConfigured(p)
        );
        if (configuredStt) {
          sttId = configuredStt.id;
          sttCfg = configuredStt;
          sttMeta = PROVIDER_CATALOG[sttId];
          updateSettings({ activeSttProvider: sttId });
        } else {
          const message = 'Add an API key in Yap Yap to start dictating.';
          // Setup is already asking for the key; Settings would open behind it.
          if (setupOpenRef.current) {
            closePlaceholder();
            return;
          }
          if (document.hasFocus() || !useFloatingHud) {
            closePlaceholder();
            setModalTab('providers');
            setModalOpen(true);
            showToast(message);
          } else {
            setHud({
              status: 'error',
              mode,
              levels: [],
              errorText: message,
            });
          }
          return;
        }
      }

      const start = Symbol();
      recorderStartRef.current = start;
      openedTargetsDuringRecording.current = false;
      // Read now, while the other app still has the selection, and resolved while the user speaks.
      selectionProbeRef.current = mode === 'ask' && appState.settings.askAboutSelection
        ? window.yapyap?.captureSelection?.(appState.settings.askCopySelection).catch(() => undefined) : undefined;
      try {
        playInteractionSound('start', appState.settings.interactionSounds);
        const desktop = window.yapyap;
        if (appState.settings.muteWhenDictating && desktop) {
          const mute = () => {
            muteTimer.current = null;
            mutedForRecording.current = true;
            void desktop.setSystemMute(true).catch(() => showToast('Could not mute system audio.'));
          };
          // Muting right away would silence the start sound.
          if (appState.settings.interactionSounds) muteTimer.current = window.setTimeout(mute, 300);
          else mute();
        }
        const pauseTip = pauseTipShown.current ? undefined : { keys: pauseHoldCombo(appState.settings.shortcuts) };
        pauseTipShown.current = true;
        setHud({
          status: 'recording',
          mode,
          levels: Array(20).fill(0.12),
          pauseTip,
        });
        if (pauseTip) {
          window.clearTimeout(pauseTipTimer.current);
          pauseTipTimer.current = window.setTimeout(() => {
            setHud((current) => current.pauseTip ? { ...current, pauseTip: undefined } : current);
          }, PAUSE_TIP_MS);
        }

        const session = await startAudioRecording(
          appState.settings.microphoneId,
          (levels) => {
            if (!recorderRef.current) return;
            setHud((prev) =>
              prev.status === 'recording' ? { ...prev, levels } : prev
            );
          },
          { strongNoiseReduction: appState.settings.strongNoiseReduction },
        );
        if (recorderStartRef.current !== start) {
          session.cancel();
          return;
        }
        recorderRef.current = session;
        recordingSinceRef.current = Date.now();
      } catch (err) {
        if (recorderStartRef.current !== start) return;
        restoreAudioMute();
        playInteractionSound('error', appState.settings.interactionSounds);
        setHud({
          status: 'error',
          mode,
          levels: Array(20).fill(0.1),
          errorText:
            err instanceof Error
              ? `Microphone access error: ${err.message}`
              : 'Could not access microphone',
        });
      } finally {
        if (recorderStartRef.current === start) recorderStartRef.current = null;
      }
    },
    [
      appState.providers,
      appState.settings.activeSttProvider,
      appState.settings.askAboutSelection,
      appState.settings.askCopySelection,
      appState.settings.interactionSounds,
      appState.settings.microphoneId,
      appState.settings.muteWhenDictating,
      appState.settings.strongNoiseReduction,
      restoreAudioMute,
      showToast,
      stopAndProcess,
      updateSettings,
      useFloatingHud,
    ]
  );

  const dismissHud = useCallback(() => {
    retryAudioRef.current = null;
    // A Transcript cancelled notice that ran out can't be undone any more.
    if (hudRef.current.status === 'cancelled') {
      cancelledRef.current = null;
      window.clearTimeout(cancelTimerRef.current);
    }
    setHud((current) => ({ ...current, status: 'idle' }));
  }, []);

  const retryHud = useCallback(() => {
    const current = hudRef.current;
    if (current.status !== 'error') return;
    const audio = retryAudioRef.current;
    if (!audio) {
      lastTriggerTimeRef.current = 0;
      void triggerDictationMode(current.mode);
      return;
    }
    hudRef.current = { ...current, status: 'processing' };
    void processAudioPipeline(...audio);
  }, [processAudioPipeline, triggerDictationMode]);

  const selectHudTarget = useCallback((target: string) => {
    const current = hudRef.current;
    if (current.status !== 'recording' || current.mode !== 'translate' ||
        !appState.settings.translationTargets.includes(target)) return;
    hudRef.current = { ...current, targetLanguage: target };
    setHud((state) => ({ ...state, targetLanguage: target }));
  }, [appState.settings.translationTargets]);

  const editHudTargets = useCallback(() => {
    if (hudRef.current.status !== 'recording' || hudRef.current.mode !== 'translate') return;
    openedTargetsDuringRecording.current = true;
    setModalTab('settings');
    setModalOpen(true);
    setShowHudTargetSettings(true);
  }, []);

  // Listen for Electron global shortcut triggers and HUD actions
  useEffect(() => {
    if (isHudRoute || !hydrated) return;
    const unsubTrigger = window.yapyap?.onTriggerMode?.((mode) => {
      if (capturingShortcut.current && document.hasFocus()) {
        setHud((current) => current.status === 'armed' ? { status: 'idle', mode: 'dictate', levels: Array(20).fill(0.1) } : current);
        return;
      }
      void triggerDictationMode(mode);
    });
    const unsubPhase = window.yapyap?.onShortcutPhase?.((phase) => {
      if (capturingShortcut.current && document.hasFocus()) return;
      const { status } = hudRef.current;
      if (phase === 'armed') {
        // An answer, error or Undo on screen stays until a shortcut actually starts;
        // a passing note like "No speech detected" gives way at once.
        if (status !== 'idle' && status !== 'notice') return;
        setHud({ status: 'armed', mode: 'dictate', levels: Array(20).fill(0.1) });
      } else if (phase === 'list') {
        if (status !== 'armed') return;
        const { shortcuts } = appState.settings;
        const shortcutList = (['dictate', 'translate', 'ask'] as const).map((mode) => ({ mode, combos: shortcuts[mode] }));
        setHud((current) => current.status === 'armed' ? { ...current, shortcutList } : current);
      } else if (phase === 'closed') {
        setHud((current) => current.status === 'armed' ? { status: 'idle', mode: 'dictate', levels: Array(20).fill(0.1) } : current);
      } else if (phase === 'busy') {
        if (status !== 'processing') return;
        setHud((current) => current.status === 'processing' ? { ...current, busyNotice: true } : current);
        window.clearTimeout(busyNoticeTimer.current);
        busyNoticeTimer.current = window.setTimeout(() => {
          setHud((current) => current.busyNotice ? { ...current, busyNotice: undefined } : current);
        }, 4000);
      }
    });
    const unsubAction = window.yapyap?.onHudAction?.((action) => {
      if (action.type === 'stop') void stopAndProcess();
      else if (action.type === 'cancel') cancelRecording();
      else if (action.type === 'pause') pauseRecording();
      else if (action.type === 'resume') resumeRecording();
      else if (action.type === 'undo') void undoCancel();
      else if (action.type === 'dismiss') dismissHud();
      else if (action.type === 'retry') retryHud();
      else if (action.type === 'select-target') selectHudTarget(action.target);
      else if (action.type === 'edit-targets') editHudTargets();
    });
    return () => {
      unsubTrigger?.();
      unsubPhase?.();
      unsubAction?.();
    };
  }, [appState.settings, cancelRecording, dismissHud, hydrated, isHudRoute, retryHud, stopAndProcess, triggerDictationMode, selectHudTarget, editHudTargets, undoCancel, pauseRecording, resumeRecording]);

  // In-window keyboard shortcut listener (ignores key repeat)
  useEffect(() => {
    if (isHudRoute) return;
    const pressed = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // The desktop app handles Esc globally; this covers the browser build.
      if (e.key === 'Escape' && !window.yapyap && hudRef.current.status === 'recording') {
        e.preventDefault();
        cancelRecording();
        return;
      }
      if (
        modalOpen ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(
          (document.activeElement?.tagName ?? '').toUpperCase()
        )
      ) {
        return;
      }
      pressed.add(normalizeKey(e));

      const { dictate, translate, ask } = appState.settings.shortcuts;
      const matches = (combo: string[]) =>
        !(globalModifiers && (combo.includes('Right Alt') || combo.every((key) => modifierOnlyKey.test(key.trim())))) &&
        comboMatches(pressed, combo);
      if (ask.some(matches)) {
        e.preventDefault();
        void triggerDictationMode('ask');
      } else if (translate.some(matches)) {
        e.preventDefault();
        void triggerDictationMode('translate');
      } else if (dictate.some(matches)) {
        e.preventDefault();
        void triggerDictationMode('dictate');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(normalizeKey(e));
    };
    const onBlur = () => pressed.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [appState.settings.shortcuts, cancelRecording, globalModifiers, isHudRoute, modalOpen, triggerDictationMode]);

  const handleCopyText = async (text: string) => {
    try {
      if (window.yapyap) await window.yapyap.copyText(text);
      else await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    } catch {
      showToast('Could not copy to clipboard.');
    }
  };

  const handleRetryHistoryItem = async (item: HistoryItem) => {
    const audioDataUrl = await loadHistoryAudio(item);
    if (audioDataUrl) {
      try {
        const blob = await dataUrlToBlob(audioDataUrl);
        await processAudioPipeline(
          blob,
          item.durationMs,
          item.mode,
          audioDataUrl,
          item.audioMimeType,
          item.id,
          item.targetLanguage,
          undefined,
          undefined,
          Promise.resolve(historySelection(item)),
        );
        return;
      } catch {
        // fall through to text-level retry
      }
    }

    const llmId = appState.settings.activeLlmProvider;
    if (llmId === 'none') {
      showToast('No AI provider selected for text retry.');
      return;
    }
    const llm = appState.providers[llmId];
    if (PROVIDER_CATALOG[llmId].requiresKey && !llm.apiKey.trim()) {
      setModalTab('providers');
      setModalOpen(true);
      showToast(`Add your ${llm.name} API key to retry.`);
      return;
    }

    try {
      const writingStyles = item.mode === 'dictate' && appState.settings.personalizationEnabled
        ? stylesForCleanup(stats.categoryBreakdown, appState.settings.styleCorrections, { category: item.writingSample?.category, defaultStyle: appState.settings.defaultStyle })
        : undefined;
      const saidSnippets = item.mode === 'dictate' ? snippetsSaidIn(item.rawText, appState.snippets, appState.dictionary) : [];
      const processed = await processTranscriptWithLlm(
        item.rawText,
        item.mode,
        llm,
        {
          targetLanguages: appState.settings.translationTargets,
          targetLanguage: item.targetLanguage,
          dictionaryWords: dictionaryWordsFor(appState.dictionary, appState.settings.personalizationEnabled),
          smartCleanup: appState.settings.smartCleanup,
          cleanupLevel: appState.settings.cleanupLevel,
          writingStyles,
          writingPreferences: item.mode === 'dictate' ? appState.settings.writingPreferences : undefined,
          // The category learned for this dictation stands in for its destination.
          destinationCategory: item.writingSample?.category,
          keepPhrases: saidSnippets.map((snippet) => snippetTriggerKey(snippet.trigger)),
          selection: historySelection(item),
        }
      );
      const cleaned = processed.finalText || item.text;
      const nextText = item.mode === 'dictate'
        ? wholeSnippet(item.rawText, appState.snippets, appState.dictionary)?.expansion
          ?? expandSnippets(
            applyDictionaryReplacements(cleaned, appState.dictionary),
            [...saidSnippets, ...snippetsFromCleanup(item.rawText, cleaned, appState.snippets, appState.dictionary)],
            appState.dictionary,
            { loose: true },
          ).text
        : cleaned;
      const nextWords = countWords(nextText);
      const nextWpm = Math.max(
        1,
        Math.round((nextWords / Math.max(1000, item.durationMs)) * 60_000)
      );
      setAppState((prev) => ({
        ...prev,
        history: prev.history.map((h) =>
          h.id === item.id
            ? {
                ...h,
                text: nextText,
                answer: processed.answer ?? h.answer,
                searchedWeb: processed.answer ? processed.searchedWeb : h.searchedWeb,
                wordCount: nextWords,
                wpm: nextWpm,
                providerId: llmId,
                model: llm.llmModel,
                // The text is the model's again, not the user's hand edit.
                writingCorrection: undefined,
                writingCorrectedAt: undefined,
                aiText: undefined,
              }
            : h
        ),
      }));
      showToast(`Retried with ${llm.name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Retry failed');
    }
  };

  /**
   * A dictation as it would read with cleanup off: the recognizer's words with the user's own
   * dictionary spellings and snippets, which are not AI edits.
   */
  const withoutAiEdit = (rawText: string): string => {
    const raw = rawText.trim();
    return wholeSnippet(raw, appState.snippets, appState.dictionary)?.expansion
      ?? expandSnippets(
        applyDictionaryReplacements(raw, appState.dictionary),
        snippetsSaidIn(raw, appState.snippets, appState.dictionary),
        appState.dictionary,
        { loose: true },
      ).text;
  };

  const aiEditState = (item: HistoryItem): 'undo' | 'redo' | undefined => {
    if (item.mode !== 'dictate' || item.outcome || !item.rawText.trim()) return undefined;
    if (item.aiText !== undefined) return 'redo';
    return item.plainText !== undefined && item.plainText !== item.text ? 'undo' : undefined;
  };

  /** Switches a dictation between its cleaned-up text and the text saved without the AI edit. */
  const handleToggleAiEdit = (item: HistoryItem) => {
    const redo = item.aiText !== undefined;
    const nextText = redo ? item.aiText! : item.plainText;
    if (nextText === undefined) return;
    const nextWords = countWords(nextText);
    setAppState((prev) => ({
      ...prev,
      history: prev.history.map((h) => h.id === item.id
        ? {
          ...h,
          text: nextText,
          aiText: redo ? undefined : h.text,
          wordCount: nextWords,
          wpm: Math.max(1, Math.round((nextWords / Math.max(1000, h.durationMs)) * 60_000)),
        }
        : h),
    }));
    showToast(redo ? 'AI edit restored' : 'AI edit undone');
  };

  const handleDownloadAudio = async (item: HistoryItem) => {
    const audioDataUrl = await loadHistoryAudio(item);
    if (!audioDataUrl) {
      showToast('No audio recording stored for this sample entry.');
      return;
    }
    const ext = item.audioMimeType?.includes('mp4')
      ? 'm4a'
      : item.audioMimeType?.includes('ogg')
      ? 'ogg'
      : 'webm';
    const a = document.createElement('a');
    a.href = audioDataUrl;
    a.download = `yapyap-${item.id}.${ext}`;
    a.click();
  };

  const handleExportHistory = () => {
    const clean = appState.history.map(({ audioDataUrl: _a, audioSaved: _s, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(clean, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'yapyap-history.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('History exported locally as JSON');
  };

  const handleImportHistory = async (file: File) => {
    let imported: HistoryItem[];
    try {
      imported = parseHistoryImport(await file.text(), appState.settings.activeSttProvider);
    } catch {
      showToast('Could not read this file. Choose a valid Yap Yap history JSON file.');
      return;
    }
    if (imported.length === 0) {
      showToast('No valid history entries found in this file.');
      return;
    }
    const fresh = skipDuplicateHistory(imported, appState.history);
    if (fresh.length === 0) {
      showToast('These history entries are already imported.');
      return;
    }
    setAppState((prev) => {
      const normalized = assignHistoryIds(skipDuplicateHistory(fresh, prev.history), prev.history.map((item) => item.id));

      const merged = [...normalized, ...prev.history].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      return {
        ...prev,
        history: filterByRetention(merged, prev.settings.historyRetention),
      };
    });
    const skipped = imported.length - fresh.length;
    showToast(`Imported ${fresh.length} history entries${skipped ? ` (${skipped} already imported)` : ''}`);
  };

  const handleEditHistoryItem = (id: string, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    const original = appState.history.find((item) => item.id === id);
    if (!original || original.text === trimmed) return;
    setAppState((prev) => {
      const target = prev.history.find((h) => h.id === id);
      if (!target) return prev;

      // Only respellings that look like names or terms join the dictionary, not every new word.
      const respelled = extractCorrections(target.text, target.text, trimmed) ?? [];
      const existingDict = new Set(prev.dictionary.map((d) => d.word.toLowerCase()));
      const autoLearned = (prev.settings.personalizationEnabled ? respelled : [])
        .filter((t) => !existingDict.has(t.toLowerCase()))
        .slice(0, 3)
        .map((w, idx) => ({
          id: `d-edit-${Date.now()}-${idx}`,
          word: w,
          source: 'auto' as const,
          createdAt: new Date().toISOString(),
        }));

      const nextWords = countWords(trimmed);
      const nextWpm = Math.max(
        1,
        Math.round((nextWords / Math.max(1000, target.durationMs)) * 60_000)
      );
      const nextCategory = classifyTranscriptCategory(trimmed, target.mode);

      return {
        ...prev,
        history: prev.history.map((h) =>
          h.id === id
            ? {
                ...h,
                text: trimmed,
                answer: h.mode === 'ask' && h.answer ? trimmed : h.answer,
                wordCount: nextWords,
                wpm: nextWpm,
                category: nextCategory,
                // A hand edit is the text now: there is no AI edit left to redo.
                aiText: undefined,
              }
            : h
        ),
        dictionary:
          autoLearned.length > 0
            ? [...autoLearned, ...prev.dictionary]
            : prev.dictionary,
      };
    });
    showToast('Transcript updated');
    const llmId = appState.settings.activeLlmProvider;
    // A hand edit teaches style only when it changed casing or punctuation, not just words.
    // Learning from an edit needs AI cleanup on: with it off, no dictation text goes to a provider.
    if (original.mode === 'dictate' && appState.settings.personalizationEnabled && appState.settings.smartCleanup && llmId !== 'none' && isStyleEdit(original.text, trimmed, extractCorrections(original.text, original.text, trimmed) ?? [])) {
      const provider = appState.providers[llmId];
      if (!isProviderConfigured(provider)) return;
      void detectWritingStyle(trimmed, provider, { category: original.writingSample?.category, before: original.text }).then((sample) => {
        if (!sample) return;
        setAppState((prev) => {
          if (!prev.settings.personalizationEnabled) return prev;
          return {
            ...prev,
            history: prev.history.map((item) => item.id === id && item.text === trimmed
              ? { ...item, writingSample: sample, writingCorrection: true, writingCorrectedAt: new Date().toISOString() }
              : item),
          };
        });
      });
    }
  };

  const handleAddDictionaryWord = (word: string, source: 'auto' | 'manual' = 'manual', heardAs?: string) => {
    const normalized = word.trim();
    if (!normalized) return;
    setAppState((prev) => {
      if (prev.dictionary.some((d) => d.word.toLowerCase() === normalized.toLowerCase())) {
        return prev;
      }
      return {
        ...prev,
        dictionary: [
          {
            id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            word: normalized,
            source,
            createdAt: new Date().toISOString(),
            ...(heardAs && { heardAs }),
          },
          ...prev.dictionary,
        ],
      };
    });
    showToast(`Added "${normalized}" to dictionary`);
  };

  const handleEditDictionaryWord = (id: string, word: string, heardAs?: string) => {
    setAppState((prev) => {
      if (prev.dictionary.some((entry) => entry.id !== id && entry.word.toLowerCase() === word.toLowerCase())) {
        return prev;
      }
      return {
        ...prev,
        dictionary: prev.dictionary.map((entry) => {
          if (entry.id !== id) return entry;
          const { heardAs: _old, ...rest } = entry;
          return { ...rest, word, ...(heardAs && { heardAs }) };
        }),
      };
    });
  };

  /** Reads Wispr Flow and Typeless again, so the review shows what they hold now. */
  const readOtherApps = useCallback(() => window.yapyap?.readOtherApps?.()
    .then((apps) => apps.filter((app) => app.words.length || app.snippets.length || app.history.length || Object.keys(app.settings).length))
    .catch(() => [] as OtherAppData[]) ?? Promise.resolve([] as OtherAppData[]), []);

  useEffect(() => {
    if (isHudRoute || !hydrated) return;
    let live = true;
    void readOtherApps().then((apps) => { if (live) setOtherApps(apps); });
    return () => { live = false; };
  }, [hydrated, isHudRoute, readOtherApps]);

  const openImport = () => {
    void readOtherApps().then((apps) => {
      setOtherApps(apps);
      setImportOpen(true);
    });
  };

  const handleImportOtherApp = (plan: ImportPlan, selection: ImportSelection) => {
    // Counted on the current state for the message; applied again to the saved state in case it changed.
    const { added } = applyImport(appState, plan, selection);
    setAppState((prev) => {
      const applied = applyImport(prev, plan, selection);
      lastImportRef.current = { receipt: applied.receipt, after: { dictionary: applied.state.dictionary, snippets: applied.state.snippets } };
      return { ...applied.state, settings: { ...applied.state.settings, dismissedImportCard: true } };
    });
    return added;
  };

  const handleImportDictionaryWords = (words: ImportedWord[]) => {
    // Counted on the current list for the message; the saved list is merged again in case it changed.
    const { added, updated } = mergeImportedWords(appState.dictionary, words);
    setAppState((prev) => ({ ...prev, dictionary: mergeImportedWords(prev.dictionary, words).dictionary }));
    const parts = [added && `Imported ${added} ${added === 1 ? 'word' : 'words'}`, updated && `added ${updated} ${updated === 1 ? 'replacement' : 'replacements'}`].filter(Boolean);
    showToast(parts.length ? parts.join(', ') : 'Everything in that file is already in your dictionary');
  };

  if (isHudRoute) {
    return (
      <DictationHud
        hud={hud}
        onSelectTarget={(target) => window.yapyap?.sendHudAction?.({ type: 'select-target', target })}
        onEditTargets={() => window.yapyap?.sendHudAction?.({ type: 'edit-targets' })}
        onStop={() => window.yapyap?.sendHudAction?.({ type: 'stop' })}
        onCancel={() => window.yapyap?.sendHudAction?.({ type: 'cancel' })}
        onPause={() => window.yapyap?.sendHudAction?.({ type: 'pause' })}
        onResume={() => window.yapyap?.sendHudAction?.({ type: 'resume' })}
        onUndo={() => window.yapyap?.sendHudAction?.({ type: 'undo' })}
        onRetry={() => window.yapyap?.sendHudAction?.({ type: 'retry' })}
        onCopyResult={(t) => window.yapyap?.sendHudAction?.({ type: 'copy', text: t })}
        onDismissResult={() => window.yapyap?.sendHudAction?.({ type: 'dismiss' })}
      />
    );
  }

  // The newest dictation, so setup's Try step can show it. History is newest first.
  const newestDictation = appState.history.find((item) => item.mode === 'dictate' && item.text.trim());
  const latestDictation = newestDictation && { id: newestDictation.id, text: newestDictation.text };

  return (
    <div className="w-screen h-screen flex overflow-hidden bg-[var(--bg-main)] text-[var(--text-primary)]">
      <Sidebar
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        onOpenModal={(tab) => {
          setModalTab(tab);
          setModalOpen(true);
        }}
        onStartDictation={(mode) => void triggerDictationMode(mode)}
        appearance={appState.settings.appearance}
        onChangeAppearance={(appearance) => updateSettings({ appearance })}
        providers={appState.providers}
        activeSttProvider={appState.settings.activeSttProvider}
        activeLlmProvider={appState.settings.activeLlmProvider}
        smartCleanup={appState.settings.smartCleanup}
        cleanupLevel={appState.settings.cleanupLevel}
        onUpdateSettings={updateSettings}
        onUpdateProvider={updateProvider}
        dismissedQuickCard={appState.settings.dismissedQuickCard}
        onDismissQuickCard={() => updateSettings({ dismissedQuickCard: true })}
        importApps={appState.settings.dismissedImportCard ? [] : otherApps.map(({ name, icon }) => ({ name, icon }))}
        onOpenImport={openImport}
        onDismissImport={() => updateSettings({ dismissedImportCard: true })}
        isRecording={hud.status === 'recording'}
      />

      <main className="flex-1 min-w-0 h-full flex flex-col relative">
        {activeNav === 'home' && (
          <HomeView
            stats={stats}
            history={completedHistory}
            settings={appState.settings}
            onOpenShare={() => setShareOpen(true)}
            onOpenModal={(tab) => {
              setModalTab(tab);
              setModalOpen(true);
            }}
            onStartDictation={(mode) => void triggerDictationMode(mode)}
            onEnablePersonalization={() => updateSettings({ personalizationEnabled: true })}
          />
        )}

        {activeNav === 'history' && (
          <HistoryView
            history={appState.history}
            retention={appState.settings.historyRetention}
            onChangeRetention={(policy) => updateSettings({ historyRetention: policy })}
            onCopyText={(t) => void handleCopyText(t)}
            onToggleFlag={(id) =>
              setAppState((prev) => ({
                ...prev,
                history: prev.history.map((h) =>
                  h.id === id ? { ...h, flagged: !h.flagged } : h
                ),
              }))
            }
            onRetryItem={(item) => void handleRetryHistoryItem(item)}
            aiEditState={aiEditState}
            onToggleAiEdit={handleToggleAiEdit}
            onDownloadAudio={handleDownloadAudio}
            onDeleteItem={(id) =>
              setAppState((prev) => ({
                ...prev,
                history: prev.history.filter((h) => h.id !== id),
              }))
            }
            onEditItem={handleEditHistoryItem}
            onClearAll={() => {
              setAppState((prev) => ({ ...prev, history: [] }));
              showToast('All local history cleared');
            }}
            onExportJson={handleExportHistory}
            onImportJson={handleImportHistory}
          />
        )}

        {activeNav === 'snippets' && (
          <SnippetsView
            snippets={appState.snippets}
            onAdd={(trigger, expansion) => {
              setAppState((prev) => ({
                ...prev,
                snippets: [{ id: `s-${Date.now()}`, trigger, expansion, createdAt: new Date().toISOString() }, ...prev.snippets],
              }));
              showToast(`Added "${trigger}"`);
            }}
            onEdit={(id, trigger, expansion) => setAppState((prev) => ({
              ...prev,
              snippets: prev.snippets.map((item) => item.id === id ? { ...item, trigger, expansion } : item),
            }))}
            onDelete={(id) => setAppState((prev) => ({ ...prev, snippets: prev.snippets.filter((item) => item.id !== id) }))}
          />
        )}

        {activeNav === 'dictionary' && (
          <DictionaryView
            entries={appState.dictionary}
            onAddWord={handleAddDictionaryWord}
            onImportWords={handleImportDictionaryWords}
            onEditWord={handleEditDictionaryWord}
            onDeleteWords={(ids) =>
              setAppState((prev) => ({
                ...prev,
                dictionary: prev.dictionary.filter((d) => !ids.includes(d.id)),
              }))
            }
          />
        )}
      </main>

      <SettingsModal
        open={modalOpen}
        activeTab={modalTab}
        onChangeTab={setModalTab}
        openTranslationTargets={showHudTargetSettings}
        onTranslationTargetsOpened={() => setShowHudTargetSettings(false)}
        onCapturingShortcutChange={setCapturingShortcut}
        onClose={() => setModalOpen(false)}
        settings={appState.settings}
        onUpdateSettings={updateSettings}
        providers={appState.providers}
        onUpdateProvider={updateProvider}
        onRemoveProvider={removeProvider}
        recentStyleSamples={recentStyleSamples}
        onForgetLearnedStyle={forgetLearnedStyle}
        onRestoreLearnedStyle={restoreLearnedStyle}
        destinations={destinations}
        onResetLearnedStyle={() => {
          forgetLearnedStyle();
          showToast('Learned style reset');
        }}
        stats={stats}
        toast={toast}
        importApps={otherApps.map(({ name, icon }) => ({ name, icon }))}
        onOpenImport={openImport}
        onRunSetup={() => {
          setModalOpen(false);
          setSetupOpen(true);
        }}
      />

      {setupOpen && (
        <Onboarding
          state={appState}
          latestDictation={latestDictation}
          hudStatus={hud.status}
          hudLevels={hud.levels}
          onTryStepChange={setSetupTrying}
          onUpdateSettings={updateSettings}
          onUpdateProvider={updateProvider}
          onRemoveProvider={removeProvider}
          onImportDictionary={handleImportDictionaryWords}
          importApps={otherApps}
          onOpenImport={openImport}
          onFinish={() => {
            setSetupOpen(false);
            updateSettings({ onboardingDone: true });
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          apps={otherApps}
          state={appState}
          defaultProvider={appState.settings.activeSttProvider}
          onImport={handleImportOtherApp}
          onUndo={() => {
            const last = lastImportRef.current;
            if (!last) return;
            lastImportRef.current = undefined;
            setAppState((prev) => undoImport(prev, last.receipt, last.after));
          }}
          onClose={() => setImportOpen(false)}
        />
      )}

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        stats={stats}
        history={completedHistory}
        onShowToast={showToast}
      />

      {!useFloatingHud && (
        <DictationHud
          hud={{ ...hud, targets: appState.settings.translationTargets }}
          onSelectTarget={selectHudTarget}
          onEditTargets={editHudTargets}
          onStop={() => void stopAndProcess()}
          onCancel={cancelRecording}
          onPause={pauseRecording}
          onResume={resumeRecording}
          onUndo={() => void undoCancel()}
          onRetry={retryHud}
          onCopyResult={(t) => void handleCopyText(t)}
          onDismissResult={dismissHud}
        />
      )}

      {toast && !modalOpen && (
        <div role="status" className="yy-toast fixed bottom-5 right-5 z-[60] px-4 py-2.5 rounded-xl text-[12.5px] font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
