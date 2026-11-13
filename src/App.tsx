import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DictationContext } from '../electron/dictationContext';
import { DictionaryView } from './components/DictionaryView';
import { DictationHud, HudState } from './components/DictationHud';
import { HistoryView } from './components/HistoryView';
import { HomeView } from './components/HomeView';
import { SettingsModal } from './components/SettingsModal';
import { ShareModal } from './components/ShareModal';
import { Sidebar } from './components/Sidebar';
import { getPreferredLanguageVariants } from './data/languages';
import { PROVIDER_CATALOG, isProviderConfigured } from './services/providers/catalog';
import { assignHistoryIds, parseHistoryImport } from './services/historyImport';
import { buildSourceCategories, categoryForDestination, destinationKey, fitToSurroundingText } from './services/personalization';
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

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.classList.contains('hide')) return;
  requestAnimationFrame(() => {
    splash.classList.add('hide');
    window.setTimeout(() => splash.remove(), 250);
  });
}

export function App() {
  const [appState, setAppState] = useState<PersistedAppState>(() => getInitialState());
  const [hydrated, setHydrated] = useState(false);

  const [activeNav, setActiveNav] = useState<ActiveNav>('home');
  const [modalOpen, setModalOpen] = useState(false);
  const [showHudTargetSettings, setShowHudTargetSettings] = useState(false);
  const [modalTab, setModalTab] = useState<SettingsModalTab>('providers');
  const [shareOpen, setShareOpen] = useState(false);
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
      setAppState({
        ...loaded,
        history: filterByRetention(loaded.history, loaded.settings.historyRetention),
      });
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
      document.documentElement.classList.toggle('dark', isDark);
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
    let ignoring = true;
    const setIgnoring = (ignore: boolean) => {
      if (ignore === ignoring) return;
      ignoring = ignore;
      window.yapyap?.setHudIgnoreMouse?.(ignore);
    };
    const onMove = (event: MouseEvent) =>
      setIgnoring(!(event.target instanceof Element && event.target.closest('.yy-hud')));
    const onLeave = () => setIgnoring(true);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
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
    void window.yapyap?.setLaunchAtLogin?.(appState.settings.launchAtLogin);
  }, [appState.settings.launchAtLogin, hydrated, isHudRoute]);

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
    const visible = hud.status !== 'idle' && useFloatingHud;
    window.yapyap?.toggleHud?.(visible, {
      ...hud,
      targets: appState.settings.translationTargets,
      appearance: appState.settings.appearance,
    });
  }, [hud, isHudRoute, useFloatingHud, appState.settings.translationTargets, appState.settings.appearance]);

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

  const updateProvider = useCallback(
    (id: ProviderId, patch: Partial<ProviderConfig>) => {
      setAppState((prev) => {
        const updatedProvider = { ...prev.providers[id], ...patch };
        const nextProviders = {
          ...prev.providers,
          [id]: updatedProvider,
        };

        let nextSettings = prev.settings;
        if (patch.apiKey && patch.apiKey.trim().length > 0) {
          const meta = PROVIDER_CATALOG[id];
          const currStt = prev.settings.activeSttProvider;
          const currSttNeedsKey =
            PROVIDER_CATALOG[currStt].requiresKey &&
            !prev.providers[currStt].apiKey.trim();
          const currLlm = prev.settings.activeLlmProvider;
          const currLlmNeedsKey =
            currLlm !== 'none' &&
            PROVIDER_CATALOG[currLlm].requiresKey &&
            !prev.providers[currLlm].apiKey.trim();

          nextSettings = {
            ...prev.settings,
            activeSttProvider:
              meta.supportsStt && currSttNeedsKey ? id : prev.settings.activeSttProvider,
            activeLlmProvider:
              meta.supportsLlm && currLlmNeedsKey ? id : prev.settings.activeLlmProvider,
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

  // Silent and cancelled recordings stay in History but never count as dictation.
  const completedHistory = useMemo(() => appState.history.filter((item) => !item.outcome), [appState.history]);

  const stats = useMemo(
    () => computeInsights(completedHistory),
    [completedHistory]
  );

  const learnedSources = useMemo(() => buildSourceCategories(completedHistory), [completedHistory]);

  const restoreAudioMute = useCallback(() => {
    if (muteTimer.current !== null) {
      window.clearTimeout(muteTimer.current);
      muteTimer.current = null;
    }
    if (!mutedForRecording.current) return;
    mutedForRecording.current = false;
    void window.yapyap?.setSystemMute(false).catch(console.warn);
  }, []);

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
    ) => {
      retryAudioRef.current = null;
      const autoPaste = mode !== 'ask' && allowAutoPaste && appState.settings.autoPaste;
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

      setHud({
        status: 'processing',
        mode,
        levels: Array(20).fill(0.1),
      });

      try {
        const dictWords = appState.dictionary
          .filter((entry) => appState.settings.personalizationEnabled || entry.source === 'manual')
          .map((entry) => entry.word);
        const rawText = await transcribeAudio(audioBlob, sttProvider, {
          dictionaryWords: dictWords,
          languageVariants: getPreferredLanguageVariants(appState.settings.languageVariants),
        });

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
        const destination = mode === 'dictate' ? await destinationProbe : undefined;
        const location = destination && { application: destination.application, domain: destination.domain };
        const source = appState.settings.personalizationEnabled ? destinationKey(location) : undefined;
        const shareText = appState.settings.contextAwareness;

        let finalText = rawText;
        let answer: string | undefined;
        let learnStyle: (() => Promise<WritingSample | undefined>) | undefined;
        let usedProviderId: ProviderId = sttProviderId;
        let usedModel = sttProvider.sttModel;

        const needsLlm =
          mode === 'translate' ||
          mode === 'ask' ||
          (mode === 'dictate' && appState.settings.smartCleanup);

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
            let writingStyles: typeof stats.categoryBreakdown | undefined;
            if (mode === 'dictate' && appState.settings.personalizationEnabled) {
              const knownCategory = categoryForDestination(location) ?? (source ? learnedSources.get(source) : undefined);
              writingStyles = knownCategory
                ? stats.categoryBreakdown.filter((item) => item.category === knownCategory)
                : stats.categoryBreakdown;
              const styleProvider = llmProvider;
              learnStyle = () => detectWritingStyle(rawText, styleProvider, {
                category: knownCategory,
                destination: location,
                existingWriting: shareText ? destination?.textBefore?.trim() || undefined : undefined,
              });
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
                writingStyles,
                destination: location && {
                  ...location,
                  nearbyText: shareText ? `${destination.textBefore ?? ''}${destination.textAfter ?? ''}`.trim() || undefined : undefined,
                },
              }
            );
            finalText = processed.finalText || rawText;
            answer = processed.answer;
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

        const category = classifyTranscriptCategory(finalText, mode);
        const words = countWords(finalText);
        const wpm = Math.max(
          1,
          Math.round((countWords(rawText) / Math.max(1000, durationMs)) * 60_000)
        );
        const autoWords = extractAutoDictionaryWords(finalText, dictWords);

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
                    answer,
                    wordCount: words,
                    wpm,
                    providerId: usedProviderId,
                    model: usedModel,
                    category,
                    outcome: undefined,
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
            answer,
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

        // Style learning runs beside delivery so it never delays the paste.
        void learnStyle?.().then((sample) => {
          if (sample) setAppState((prev) => prev.settings.personalizationEnabled ? {
            ...prev,
            history: prev.history.map((h) => h.id === itemId && !h.writingCorrection ? { ...h, writingSample: sample } : h),
          } : prev);
        });

        const desktop = window.yapyap;
        const delivered = mode === 'dictate' ? fitToSurroundingText(finalText, destination?.textBefore, dictWords) : finalText;
        const pasted = await deliverDictationResult(
          mode,
          delivered,
          autoPaste ? desktop?.pasteText : undefined,
          async (text) => {
            if (desktop) await desktop.copyText(text);
            else await navigator.clipboard?.writeText(text);
          },
        );

        // Words the user respells in the destination right after the paste join the dictionary.
        if (pasted && mode === 'dictate' && appState.settings.personalizationEnabled) {
          void desktop?.watchPasteCorrections?.(delivered).then((words) => {
            if (!words?.length) return;
            let added: string[] = [];
            setAppState((prev) => {
              const known = new Set(prev.dictionary.map((entry) => entry.word.toLowerCase()));
              added = prev.settings.personalizationEnabled ? words.filter((word) => !known.has(word.toLowerCase())) : [];
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
          status: pasted ? 'idle' : 'result',
          mode,
          levels: Array(20).fill(0.1),
          resultText: finalText,
          questionText: mode === 'ask' ? rawText : undefined,
        });
      } catch (err) {
        retryAudioRef.current = [
          audioBlob, durationMs, mode, audioDataUrl, audioMimeType, existingItemId, targetLanguage, allowAutoPaste,
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
    [appState.dictionary, appState.providers, appState.settings, learnedSources, stats.categoryBreakdown]
  );

  const retryAudioRef = useRef<Parameters<typeof processAudioPipeline> | null>(null);

  const stopAndProcess = useCallback(async () => {
    const session = recorderRef.current;
    if (!session) return;
    recorderRef.current = null;
    restoreAudioMute();
    const { mode: currentMode, targetLanguage } = hudRef.current;
    const allowAutoPaste = !openedTargetsDuringRecording.current || !document.hasFocus();
    const destinationProbe = currentMode === 'dictate'
      ? window.yapyap?.captureDictationContext?.().catch(() => undefined) : undefined;
    setHud((current) => ({ ...current, status: 'processing' }));
    try {
      const { blob, durationMs, dataUrl, mimeType } = await session.stop();
      const targets = appState.settings.translationTargets;
      const selectedTarget = currentMode === 'translate'
        ? targetLanguage && targets.includes(targetLanguage) ? targetLanguage : targets[0] ?? 'English'
        : undefined;
      await processAudioPipeline(blob, durationMs, currentMode, dataUrl, mimeType, undefined, selectedTarget, allowAutoPaste, destinationProbe);
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

  const cancelRecording = useCallback(() => {
    retryAudioRef.current = null;
    recorderStartRef.current = null;
    const session = recorderRef.current;
    recorderRef.current = null;
    restoreAudioMute();
    const { mode, targetLanguage } = hudRef.current;
    if (!session) {
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
      return [blob, durationMs, mode, dataUrl, mimeType, id, selectedTarget, allowAutoPaste] as Parameters<typeof processAudioPipeline>;
    }).catch(() => null);
    setHud({ status: 'cancelled', mode, levels: Array(20).fill(0.1) });
    window.clearTimeout(cancelTimerRef.current);
    cancelTimerRef.current = window.setTimeout(() => {
      cancelledRef.current = null;
      setHud((current) => current.status === 'cancelled' ? { ...current, status: 'idle' } : current);
    }, 5000);
  }, [appState.settings.activeSttProvider, appState.settings.translationTargets, restoreAudioMute]);

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
    audio[8] = audio[2] === 'dictate' ? window.yapyap?.captureDictationContext?.().catch(() => undefined) : undefined;
    await processAudioPipeline(...audio);
  }, [processAudioPipeline]);

  const triggerDictationMode = useCallback(
    async (mode: DictationMode) => {
      const now = Date.now();
      // Guard against duplicate globalShortcut + DOM keydown firing within 350ms
      if (now - lastTriggerTimeRef.current < 350) {
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
          if (document.hasFocus() || !useFloatingHud) {
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
        setHud({
          status: 'recording',
          mode,
          levels: Array(20).fill(0.12),
        });

        const session = await startAudioRecording(
          appState.settings.microphoneId,
          (levels) => {
            if (!recorderRef.current) return;
            setHud((prev) =>
              prev.status === 'recording' ? { ...prev, levels } : prev
            );
          }
        );
        if (recorderStartRef.current !== start) {
          session.cancel();
          return;
        }
        recorderRef.current = session;
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
      appState.settings.interactionSounds,
      appState.settings.microphoneId,
      appState.settings.muteWhenDictating,
      restoreAudioMute,
      showToast,
      stopAndProcess,
      updateSettings,
      useFloatingHud,
    ]
  );

  const dismissHud = useCallback(() => {
    retryAudioRef.current = null;
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
      if (modalOpen && document.hasFocus()) return;
      void triggerDictationMode(mode);
    });
    const unsubAction = window.yapyap?.onHudAction?.((action) => {
      if (action.type === 'stop') void stopAndProcess();
      else if (action.type === 'cancel') cancelRecording();
      else if (action.type === 'undo') void undoCancel();
      else if (action.type === 'dismiss') dismissHud();
      else if (action.type === 'retry') retryHud();
      else if (action.type === 'select-target') selectHudTarget(action.target);
      else if (action.type === 'edit-targets') editHudTargets();
    });
    return () => {
      unsubTrigger?.();
      unsubAction?.();
    };
  }, [cancelRecording, dismissHud, hydrated, isHudRoute, modalOpen, retryHud, stopAndProcess, triggerDictationMode, selectHudTarget, editHudTargets, undoCancel]);

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
    if (item.audioDataUrl) {
      try {
        const blob = await dataUrlToBlob(item.audioDataUrl);
        await processAudioPipeline(
          blob,
          item.durationMs,
          item.mode,
          item.audioDataUrl,
          item.audioMimeType,
          item.id,
          item.targetLanguage
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
        ? stats.categoryBreakdown.filter((entry) => !item.writingSample || entry.category === item.writingSample.category)
        : undefined;
      const processed = await processTranscriptWithLlm(
        item.rawText,
        item.mode,
        llm,
        {
          targetLanguages: appState.settings.translationTargets,
          targetLanguage: item.targetLanguage,
          dictionaryWords: appState.dictionary
            .filter((entry) => appState.settings.personalizationEnabled || entry.source === 'manual')
            .map((entry) => entry.word),
          smartCleanup: appState.settings.smartCleanup,
          writingStyles,
        }
      );
      const nextText = processed.finalText || item.text;
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
                wordCount: nextWords,
                wpm: nextWpm,
                providerId: llmId,
                model: llm.llmModel,
              }
            : h
        ),
      }));
      showToast(`Retried with ${llm.name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Retry failed');
    }
  };

  const handleDownloadAudio = (item: HistoryItem) => {
    if (!item.audioDataUrl) {
      showToast('No audio recording stored for this sample entry.');
      return;
    }
    const ext = item.audioMimeType?.includes('mp4')
      ? 'm4a'
      : item.audioMimeType?.includes('ogg')
      ? 'ogg'
      : 'webm';
    const a = document.createElement('a');
    a.href = item.audioDataUrl;
    a.download = `yapyap-${item.id}.${ext}`;
    a.click();
  };

  const handleExportHistory = () => {
    const clean = appState.history.map(({ audioDataUrl: _a, ...rest }) => rest);
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
    setAppState((prev) => {
      const normalized = assignHistoryIds(imported, prev.history.map((item) => item.id));

      const merged = [...normalized, ...prev.history].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      return {
        ...prev,
        history: filterByRetention(merged, prev.settings.historyRetention),
      };
    });
    showToast(`Imported ${imported.length} history entries`);
  };

  const handleEditHistoryItem = (id: string, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    const original = appState.history.find((item) => item.id === id);
    if (!original || original.text === trimmed) return;
    setAppState((prev) => {
      const target = prev.history.find((h) => h.id === id);
      if (!target) return prev;

      const oldTokens = new Set(
        target.text
          .split(/\s+/)
          .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
          .filter(Boolean)
      );
      const newTokens = trimmed
        .split(/\s+/)
        .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter((t) => t.length >= 3 && !oldTokens.has(t.toLowerCase()));

      const existingDict = new Set(prev.dictionary.map((d) => d.word.toLowerCase()));
      const autoLearned = (prev.settings.personalizationEnabled ? newTokens : [])
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
    if (original.mode === 'dictate' && appState.settings.personalizationEnabled && llmId !== 'none') {
      const provider = appState.providers[llmId];
      if (!isProviderConfigured(provider)) return;
      void detectWritingStyle(trimmed, provider, { category: original.writingSample?.category, before: original.text }).then((sample) => {
        if (!sample) return;
        setAppState((prev) => {
          if (!prev.settings.personalizationEnabled) return prev;
          return {
            ...prev,
            history: prev.history.map((item) => item.id === id && item.text === trimmed
              ? { ...item, writingSample: sample, writingCorrection: true }
              : item),
          };
        });
      });
    }
  };

  const handleAddDictionaryWord = (word: string, source: 'auto' | 'manual' = 'manual') => {
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
          },
          ...prev.dictionary,
        ],
      };
    });
    showToast(`Added "${normalized}" to dictionary`);
  };

  const handleEditDictionaryWord = (id: string, word: string) => {
    setAppState((prev) => {
      if (prev.dictionary.some((entry) => entry.id !== id && entry.word.toLowerCase() === word.toLowerCase())) {
        return prev;
      }
      return {
        ...prev,
        dictionary: prev.dictionary.map((entry) => entry.id === id ? { ...entry, word } : entry),
      };
    });
  };

  const handleImportDictionaryWords = (words: string[]) => {
    setAppState((prev) => {
      const existing = new Set(prev.dictionary.map((d) => d.word.toLowerCase()));
      const additions = words
        .filter((w) => !existing.has(w.toLowerCase()))
        .map((w, idx) => ({
          id: `d-${Date.now()}-${idx}`,
          word: w,
          source: 'manual' as const,
          createdAt: new Date().toISOString(),
        }));
      return {
        ...prev,
        dictionary: [...additions, ...prev.dictionary],
      };
    });
    showToast(`Imported ${words.length} words`);
  };

  if (isHudRoute) {
    return (
      <DictationHud
        hud={hud}
        onSelectTarget={(target) => window.yapyap?.sendHudAction?.({ type: 'select-target', target })}
        onEditTargets={() => window.yapyap?.sendHudAction?.({ type: 'edit-targets' })}
        onStop={() => window.yapyap?.sendHudAction?.({ type: 'stop' })}
        onCancel={() => window.yapyap?.sendHudAction?.({ type: 'cancel' })}
        onUndo={() => window.yapyap?.sendHudAction?.({ type: 'undo' })}
        onRetry={() => window.yapyap?.sendHudAction?.({ type: 'retry' })}
        onCopyResult={(t) => window.yapyap?.sendHudAction?.({ type: 'copy', text: t })}
        onDismissResult={() => window.yapyap?.sendHudAction?.({ type: 'dismiss' })}
      />
    );
  }

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
        providers={appState.providers}
        activeSttProvider={appState.settings.activeSttProvider}
        dismissedQuickCard={appState.settings.dismissedQuickCard}
        onDismissQuickCard={() => updateSettings({ dismissedQuickCard: true })}
        isRecording={hud.status === 'recording'}
        totalWords={stats.totalWords}
      />

      <main className="flex-1 min-w-0 h-full flex flex-col relative">
        {activeNav === 'home' && (
          <HomeView
            stats={stats}
            history={completedHistory}
            settings={appState.settings}
            providers={appState.providers}
            onOpenShare={() => setShareOpen(true)}
            onOpenModal={(tab) => {
              setModalTab(tab);
              setModalOpen(true);
            }}
            onStartDictation={(mode) => void triggerDictationMode(mode)}
            onDismissPromoCard={() => updateSettings({ dismissedPromoCard: true })}
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
        onClose={() => setModalOpen(false)}
        settings={appState.settings}
        onUpdateSettings={updateSettings}
        providers={appState.providers}
        onUpdateProvider={updateProvider}
        stats={stats}
        toast={toast}
      />

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
          onUndo={() => void undoCancel()}
          onRetry={retryHud}
          onCopyResult={(t) => void handleCopyText(t)}
          onDismissResult={dismissHud}
        />
      )}

      {toast && !modalOpen && (
        <div role="status" className="fixed bottom-5 right-5 z-[60] px-4 py-2.5 rounded-xl bg-[#141416] text-white text-[12.5px] font-medium shadow-xl border border-white/10">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
