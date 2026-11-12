import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DictionaryView } from './components/DictionaryView';
import { DictationHud, HudState } from './components/DictationHud';
import { HistoryView } from './components/HistoryView';
import { HomeView } from './components/HomeView';
import { SettingsModal } from './components/SettingsModal';
import { ShareModal } from './components/ShareModal';
import { Sidebar } from './components/Sidebar';
import { PROVIDER_CATALOG } from './services/providers/catalog';
import {
  processTranscriptWithLlm,
  transcribeAudio,
} from './services/providers/engine';
import { computeInsights, countWords, filterByRetention } from './services/stats';
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
} from './types/app';
import {
  RecorderSession,
  dataUrlToBlob,
  startAudioRecording,
} from './utils/audioRecorder';
import { playInteractionSound } from './utils/sounds';

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

export function App() {
  const [appState, setAppState] = useState<PersistedAppState>(() => getInitialState());
  const [hydrated, setHydrated] = useState(false);

  const [activeNav, setActiveNav] = useState<ActiveNav>('home');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<SettingsModalTab>('providers');
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [hud, setHud] = useState<HudState>({
    status: 'idle',
    mode: 'dictate',
    levels: Array(20).fill(0.1),
    elapsedMs: 0,
  });

  const recorderRef = useRef<RecorderSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const hudRef = useRef<HudState>(hud);
  hudRef.current = hud;

  const isHudRoute =
    typeof window !== 'undefined' && window.location.hash === '#/hud';

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Load persisted state on boot
  useEffect(() => {
    loadPersistedState().then((loaded) => {
      setAppState({
        ...loaded,
        history: filterByRetention(loaded.history, loaded.settings.historyRetention),
      });
      setHydrated(true);
    });
  }, []);

  // Persist on changes
  useEffect(() => {
    if (!hydrated) return;
    void savePersistedState(appState);
  }, [appState, hydrated]);

  // Apply light/dark theme class
  useEffect(() => {
    const mode = appState.settings.appearance;
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isDark = mode === 'dark' || (mode === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, [appState.settings.appearance]);

  // Sync Electron global shortcuts + login item
  useEffect(() => {
    if (!hydrated) return;
    void window.yapyap?.updateShortcuts?.(appState.settings.shortcuts);
  }, [appState.settings.shortcuts, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    void window.yapyap?.setLaunchAtLogin?.(appState.settings.launchAtLogin);
  }, [appState.settings.launchAtLogin, hydrated]);

  // HUD-only route body styling
  useEffect(() => {
    if (isHudRoute) {
      document.body.classList.add('hud-mode');
    }
    return () => document.body.classList.remove('hud-mode');
  }, [isHudRoute]);

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
      setAppState((prev) => ({
        ...prev,
        providers: {
          ...prev.providers,
          [id]: { ...prev.providers[id], ...patch },
        },
      }));
    },
    []
  );

  const stats = useMemo(
    () => computeInsights(appState.history, appState.dictionary.length),
    [appState.history, appState.dictionary.length]
  );

  const stopRecordingTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const processAudioPipeline = useCallback(
    async (
      audioBlob: Blob,
      durationMs: number,
      mode: DictationMode,
      audioDataUrl?: string,
      audioMimeType?: string
    ) => {
      const sttProviderId = appState.settings.activeSttProvider;
      const sttProvider = appState.providers[sttProviderId];
      const llmSelection = appState.settings.activeLlmProvider;

      setHud({
        status: 'processing',
        mode,
        levels: Array(20).fill(0.1),
        elapsedMs: durationMs,
        providerLabel: sttProvider.name,
      });

      try {
        const dictWords = appState.dictionary.map((d) => d.word);
        const rawText = await transcribeAudio(audioBlob, sttProvider, {
          dictionaryWords: dictWords,
        });

        if (!rawText) {
          throw new Error('No speech was detected in the recording.');
        }

        let finalText = rawText;
        let answer: string | undefined;
        let usedProviderId: ProviderId = sttProviderId;
        let usedModel = sttProvider.sttModel;

        const needsLlm =
          mode === 'translate' ||
          mode === 'ask' ||
          (mode === 'dictate' && appState.settings.smartCleanup);

        if (needsLlm && llmSelection !== 'none') {
          const llmProvider = appState.providers[llmSelection];
          const llmMeta = PROVIDER_CATALOG[llmSelection];
          const hasLlmKey =
            llmProvider.apiKey.trim().length > 0 || !llmMeta.requiresKey;

          if (hasLlmKey) {
            const processed = await processTranscriptWithLlm(
              rawText,
              mode,
              llmProvider,
              {
                targetLanguages: appState.settings.translationTargets,
                dictionaryWords: dictWords,
                smartCleanup: appState.settings.smartCleanup,
              }
            );
            finalText = processed.finalText || rawText;
            answer = processed.answer;
            if (mode !== 'dictate') {
              usedProviderId = llmSelection;
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

        const words = countWords(finalText);
        const wpm = Math.max(
          1,
          Math.round((countWords(rawText) / Math.max(1000, durationMs)) * 60_000)
        );

        const newItem: HistoryItem = {
          id: `h-${Date.now()}`,
          createdAt: new Date().toISOString(),
          mode,
          rawText,
          text: finalText,
          answer,
          targetLanguage:
            mode === 'translate' ? appState.settings.translationTargets[0] : undefined,
          durationMs,
          wordCount: words,
          wpm,
          providerId: usedProviderId,
          model: usedModel,
          audioDataUrl,
          audioMimeType,
          category: mode === 'ask' ? 'AI assistants' : 'Messaging',
        };

        setAppState((prev) => ({
          ...prev,
          history: [newItem, ...prev.history],
        }));

        // Copy & optionally auto-paste
        if (appState.settings.autoPaste && window.yapyap?.pasteText) {
          await window.yapyap.pasteText(finalText);
        } else {
          await navigator.clipboard?.writeText(finalText).catch(() => {});
        }

        playInteractionSound('stop', appState.settings.interactionSounds);

        setHud({
          status: 'result',
          mode,
          levels: Array(20).fill(0.1),
          elapsedMs: durationMs,
          resultText: finalText,
          providerLabel: appState.providers[usedProviderId].name,
        });

        window.setTimeout(() => {
          setHud((curr) =>
            curr.status === 'result' && curr.resultText === finalText
              ? { ...curr, status: 'idle' }
              : curr
          );
        }, mode === 'ask' ? 12000 : 4500);
      } catch (err) {
        playInteractionSound('error', appState.settings.interactionSounds);
        const message = err instanceof Error ? err.message : 'Transcription failed';
        setHud({
          status: 'error',
          mode,
          levels: Array(20).fill(0.1),
          elapsedMs: durationMs,
          errorText: message,
        });
      }
    },
    [appState.dictionary, appState.providers, appState.settings]
  );

  const stopAndProcess = useCallback(async () => {
    const session = recorderRef.current;
    if (!session) return;
    recorderRef.current = null;
    stopRecordingTimer();
    const currentMode = hudRef.current.mode;
    try {
      const { blob, durationMs, dataUrl, mimeType } = await session.stop();
      await processAudioPipeline(blob, durationMs, currentMode, dataUrl, mimeType);
    } catch (err) {
      playInteractionSound('error', appState.settings.interactionSounds);
      setHud({
        status: 'error',
        mode: currentMode,
        levels: Array(20).fill(0.1),
        elapsedMs: 0,
        errorText: err instanceof Error ? err.message : 'Recording stopped unexpectedly',
      });
    }
  }, [appState.settings.interactionSounds, processAudioPipeline]);

  const cancelRecording = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    stopRecordingTimer();
    setHud({
      status: 'idle',
      mode: 'dictate',
      levels: Array(20).fill(0.1),
      elapsedMs: 0,
    });
  }, []);

  const triggerDictationMode = useCallback(
    async (mode: DictationMode) => {
      // If already recording, pressing trigger stops and transcribes
      if (hudRef.current.status === 'recording') {
        await stopAndProcess();
        return;
      }
      if (hudRef.current.status === 'processing') return;

      const sttId = appState.settings.activeSttProvider;
      const sttCfg = appState.providers[sttId];
      const sttMeta = PROVIDER_CATALOG[sttId];
      if (sttMeta.requiresKey && !sttCfg.apiKey.trim()) {
        setModalTab('providers');
        setModalOpen(true);
        showToast(`Add your ${sttMeta.name} API key first to start dictating.`);
        return;
      }

      try {
        playInteractionSound('start', appState.settings.interactionSounds);
        const startTime = Date.now();
        setHud({
          status: 'recording',
          mode,
          levels: Array(20).fill(0.12),
          elapsedMs: 0,
          providerLabel: sttCfg.name,
        });

        const session = await startAudioRecording(
          appState.settings.microphoneId,
          (levels) => {
            setHud((prev) =>
              prev.status === 'recording' ? { ...prev, levels } : prev
            );
          }
        );
        recorderRef.current = session;

        timerRef.current = window.setInterval(() => {
          setHud((prev) =>
            prev.status === 'recording'
              ? { ...prev, elapsedMs: Date.now() - startTime }
              : prev
          );
        }, 200);
      } catch (err) {
        playInteractionSound('error', appState.settings.interactionSounds);
        setHud({
          status: 'error',
          mode,
          levels: Array(20).fill(0.1),
          elapsedMs: 0,
          errorText:
            err instanceof Error
              ? `Microphone access error: ${err.message}`
              : 'Could not access microphone',
        });
      }
    },
    [
      appState.providers,
      appState.settings.activeSttProvider,
      appState.settings.interactionSounds,
      appState.settings.microphoneId,
      showToast,
      stopAndProcess,
    ]
  );

  // Listen for Electron global shortcut triggers
  useEffect(() => {
    if (!window.yapyap?.onTriggerMode) return;
    return window.yapyap.onTriggerMode((mode) => {
      void triggerDictationMode(mode);
    });
  }, [triggerDictationMode]);

  // In-window keyboard shortcut listener (also supports Right Alt alone!)
  useEffect(() => {
    if (isHudRoute) return;
    const pressed = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
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
      if (ask.some((c) => comboMatches(pressed, c))) {
        e.preventDefault();
        void triggerDictationMode('ask');
      } else if (translate.some((c) => comboMatches(pressed, c))) {
        e.preventDefault();
        void triggerDictationMode('translate');
      } else if (dictate.some((c) => comboMatches(pressed, c))) {
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
  }, [appState.settings.shortcuts, isHudRoute, modalOpen, triggerDictationMode]);

  const handleCopyText = async (text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    showToast('Copied to clipboard');
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
          item.audioMimeType
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
      const processed = await processTranscriptWithLlm(
        item.rawText,
        item.mode,
        llm,
        {
          targetLanguages: appState.settings.translationTargets,
          dictionaryWords: appState.dictionary.map((d) => d.word),
          smartCleanup: appState.settings.smartCleanup,
        }
      );
      setAppState((prev) => ({
        ...prev,
        history: prev.history.map((h) =>
          h.id === item.id
            ? {
                ...h,
                text: processed.finalText || h.text,
                answer: processed.answer ?? h.answer,
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
    showToast('History exported as JSON');
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
        onStop={() => void stopAndProcess()}
        onCancel={cancelRecording}
        onCopyResult={(t) => void handleCopyText(t)}
        onDismissResult={() => setHud((h) => ({ ...h, status: 'idle' }))}
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
      />

      <main className="flex-1 min-w-0 h-full flex flex-col relative">
        {activeNav === 'home' && (
          <HomeView
            stats={stats}
            history={appState.history}
            settings={appState.settings}
            providers={appState.providers}
            onOpenShare={() => setShareOpen(true)}
            onOpenModal={(tab) => {
              setModalTab(tab);
              setModalOpen(true);
            }}
            onStartDictation={(mode) => void triggerDictationMode(mode)}
            onDismissPromoCard={() => updateSettings({ dismissedPromoCard: true })}
            onShowToast={showToast}
          />
        )}

        {activeNav === 'history' && (
          <HistoryView
            history={appState.history}
            retention={appState.settings.historyRetention}
            cloudSyncMock={appState.settings.cloudSyncMock}
            onChangeRetention={(policy) => updateSettings({ historyRetention: policy })}
            onToggleCloudSync={() =>
              updateSettings({ cloudSyncMock: !appState.settings.cloudSyncMock })
            }
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
            onClearSamples={() => {
              setAppState((prev) => ({
                ...prev,
                history: prev.history.filter((h) => !h.isSample),
              }));
              showToast('Sample data cleared');
            }}
            onClearAll={() => {
              setAppState((prev) => ({ ...prev, history: [] }));
              showToast('All history cleared');
            }}
            onExportJson={handleExportHistory}
          />
        )}

        {activeNav === 'dictionary' && (
          <DictionaryView
            entries={appState.dictionary}
            onAddWord={handleAddDictionaryWord}
            onImportWords={handleImportDictionaryWords}
            onDeleteWord={(id) =>
              setAppState((prev) => ({
                ...prev,
                dictionary: prev.dictionary.filter((d) => d.id !== id),
              }))
            }
          />
        )}
      </main>

      <SettingsModal
        open={modalOpen}
        activeTab={modalTab}
        onChangeTab={setModalTab}
        onClose={() => setModalOpen(false)}
        settings={appState.settings}
        onUpdateSettings={updateSettings}
        providers={appState.providers}
        onUpdateProvider={updateProvider}
        stats={stats}
        onShowToast={showToast}
      />

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        stats={stats}
        history={appState.history}
        onShowToast={showToast}
      />

      <DictationHud
        hud={hud}
        onStop={() => void stopAndProcess()}
        onCancel={cancelRecording}
        onCopyResult={(t) => void handleCopyText(t)}
        onDismissResult={() => setHud((h) => ({ ...h, status: 'idle' }))}
      />

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] px-4 py-2.5 rounded-xl bg-[#141416] text-white text-[12.5px] font-medium shadow-xl border border-white/10">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
