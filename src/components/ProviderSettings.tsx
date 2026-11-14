import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import claudeLogo from '../assets/providers/claude.svg';
import deepgramLogo from '../assets/providers/deepgram.svg';
import elevenlabsLogo from '../assets/providers/elevenlabs.svg';
import geminiLogo from '../assets/providers/gemini.svg';
import groqLogo from '../assets/providers/groq.svg';
import openaiLogo from '../assets/providers/openai.svg';
import { isProviderConfigured, PROVIDER_CATALOG, PROVIDER_ORDER } from '../services/providers/catalog';
import { listProviderModels, testProviderConnection } from '../services/providers/engine';
import type { ProviderConfig, ProviderId, ProviderModel, SettingsState } from '../types/app';
import { SelectMenu } from './SelectMenu';
import './ProviderSettings.css';

interface Props {
  providers: Record<ProviderId, ProviderConfig>;
  settings: SettingsState;
  onUpdateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  onRemoveProvider: (id: ProviderId) => void;
  onUpdateSettings: (patch: Partial<SettingsState>) => void;
}

type View = { type: 'list' } | { type: 'add' | 'manage'; id: ProviderId };

const providerLogos: Record<Exclude<ProviderId, 'custom'>, string> = {
  anthropic: claudeLogo,
  deepgram: deepgramLogo,
  elevenlabs: elevenlabsLogo,
  gemini: geminiLogo,
  groq: groqLogo,
  openai: openaiLogo,
};

function ProviderIcon({ id }: { id: ProviderId }) {
  return (
    <span aria-hidden="true" className="provider-icon" data-provider={id}>
      {id === 'custom' ? <Settings2 size={17} /> : <img src={providerLogos[id]} alt="" width={20} height={20} />}
    </span>
  );
}

export function ProviderSettings({ providers, settings, onUpdateProvider, onRemoveProvider, onUpdateSettings }: Props) {
  const [view, navigate] = useState<View>({ type: 'list' });
  const heading = useRef<HTMLHeadingElement>(null);
  const configured = PROVIDER_ORDER.filter((id) => isProviderConfigured(providers[id]));
  const available = PROVIDER_ORDER.filter((id) => !configured.includes(id));

  useLayoutEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start' });
  }, [view.type]);

  if ('id' in view) {
    const { id } = view;
    const adding = view.type === 'add';
    const name = PROVIDER_CATALOG[id].name;
    const back = () => navigate({ type: 'list' });
    return (
      <div className="provider-settings">
        <BackButton onClick={back}>Providers &amp; API Keys</BackButton>
        <header className="provider-heading provider-form-heading">
          <ProviderIcon id={id} />
          <h2 ref={heading} tabIndex={-1}>
            {adding ? `Connect ${name}` : `Manage ${name}`}
          </h2>
        </header>
        <ProviderForm
          key={id}
          provider={providers[id]}
          adding={adding}
          onCancel={back}
          onRefresh={(discoveredModels) => onUpdateProvider(id, { discoveredModels })}
          onRemove={adding ? undefined : () => {
            onRemoveProvider(id);
            navigate({ type: 'list' });
          }}
          onSave={(patch) => {
            onUpdateProvider(id, patch);
            navigate({ type: 'list' });
          }}
        />
      </div>
    );
  }

  const speechOptions = configured
    .filter((id) => PROVIDER_CATALOG[id].supportsStt)
    .map((id) => ({ value: id, label: providers[id].name }));
  const aiOptions = configured
    .filter((id) => PROVIDER_CATALOG[id].supportsLlm)
    .map((id) => ({ value: id, label: providers[id].name }));

  return (
    <div className="provider-settings">
      <header className="provider-heading provider-overview">
        <h2 ref={heading} tabIndex={-1}>Providers &amp; API Keys</h2>
      </header>

      {configured.length > 0 && (
        <>
          <section className="provider-defaults" aria-label="Default providers">
            <div className="provider-default">
              <label htmlFor="default-stt-provider"><AudioLines size={15} aria-hidden="true" /> Dictation</label>
              <SelectMenu
                id="default-stt-provider"
                label="Default dictation provider"
                value={settings.activeSttProvider}
                options={speechOptions}
                placeholder={speechOptions.length ? 'Select a provider' : 'Add a speech provider'}
                onChange={(activeSttProvider) => onUpdateSettings({ activeSttProvider })}
              />
            </div>
            <div className="provider-default">
              <label htmlFor="default-llm-provider"><Sparkles size={15} aria-hidden="true" /> Cleanup, translation &amp; Ask</label>
              <SelectMenu
                id="default-llm-provider"
                label="Default AI provider"
                value={settings.activeLlmProvider}
                options={[...aiOptions, { value: 'none', label: 'None' }]}
                placeholder={aiOptions.length ? 'Select a provider' : 'Add an AI provider'}
                onChange={(activeLlmProvider) => onUpdateSettings({ activeLlmProvider })}
              />
            </div>
          </section>

          <section aria-labelledby="configured-providers-heading">
            <h3 className="provider-list-heading" id="configured-providers-heading">Connected providers</h3>
            <ul className="provider-list">
              {configured.map((id) => {
                const provider = providers[id];
                const meta = PROVIDER_CATALOG[id];
                const summary = [provider.sttModel, provider.llmModel].filter(Boolean).join(' · ');
                return (
                  <li key={id}>
                    <button type="button" className="provider-row provider-choice" aria-label={`Manage ${meta.name}`} onClick={() => navigate({ type: 'manage', id })}>
                      <ProviderIcon id={id} />
                      <span className="provider-row-content">
                        <strong>{meta.name}</strong>
                        <span>{provider.status === 'error' ? 'Check connection' : summary}</span>
                      </span>
                      <span className="provider-manage-label" aria-hidden="true">Manage</span>
                      <ChevronRight size={15} className="provider-chevron" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {available.length > 0 && (
        <section aria-labelledby="available-providers-heading">
          <h3 className="provider-list-heading" id="available-providers-heading">
            Available providers
          </h3>
          <ul id="available-providers" className="provider-list">
            {available.map((id) => {
              const meta = PROVIDER_CATALOG[id];
              return (
                <li key={id}>
                  <button type="button" className="provider-row provider-choice" onClick={() => navigate({ type: 'add', id })}>
                    <ProviderIcon id={id} />
                    <span className="provider-row-content">
                      <strong>{meta.name}</strong>
                      <span>{meta.tagline}</span>
                    </span>
                    <ChevronRight size={16} className="provider-chevron" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="provider-privacy">API keys are stored on this device and sent directly to your provider.</p>
    </div>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" className="provider-back" onClick={onClick}>
      <ArrowLeft size={15} aria-hidden="true" />
      {children}
    </button>
  );
}

function ProviderForm({ provider, adding, onCancel, onRefresh, onRemove, onSave }: {
  provider: ProviderConfig;
  adding: boolean;
  onCancel: () => void;
  onRefresh: (models: NonNullable<ProviderConfig['discoveredModels']>) => void;
  onRemove?: () => void;
  onSave: (patch: Partial<ProviderConfig>) => void;
}) {
  const meta = PROVIDER_CATALOG[provider.id];
  const custom = provider.id === 'custom';
  const [apiKey, setApiKey] = useState(adding ? '' : provider.apiKey);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? meta.defaultBaseUrl ?? '');
  const [sttModel, setSttModel] = useState(provider.sttModel);
  const [llmModel, setLlmModel] = useState(provider.llmModel);
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [error, setError] = useState('');
  const removalDialog = useRef<HTMLDialogElement>(null);
  const keepProviderButton = useRef<HTMLButtonElement>(null);
  const removalTitleId = useId();
  const removalDescriptionId = useId();
  const pending = useRef<symbol | null>(null);
  const key = apiKey.trim();
  const endpoint = baseUrl.trim().replace(/\/+$/, '');
  const originalEndpoint = (provider.baseUrl?.trim() || meta.defaultBaseUrl)?.replace(/\/+$/, '');
  const connectionChanged = key !== provider.apiKey.trim() || (custom && endpoint !== originalEndpoint);
  const discovered = !adding && !connectionChanged ? provider.discoveredModels : undefined;
  const busy = checking || refreshing;

  useLayoutEffect(() => () => { pending.current = null; }, []);

  async function refreshModels() {
    if (pending.current || connectionChanged) return;
    const attempt = Symbol();
    pending.current = attempt;
    setRefreshing(true);
    setRefreshMessage('');
    const result = await listProviderModels(provider);
    if (pending.current !== attempt) return;
    pending.current = null;
    setRefreshing(false);

    if (result.ok && result.models && (result.models.speech.length || result.models.ai.length)) {
      onRefresh(result.models);
      setRefreshMessage('Model list updated.');
    } else {
      setRefreshMessage('No models could be loaded. You can keep your current model or enter a model ID.');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setError('');

    const models = {
      sttModel: sttModel.trim() || provider.sttModel,
      llmModel: llmModel.trim() || provider.llmModel,
      modelsSelected: true,
    };

    if (meta.requiresKey && !key) {
      setError('Enter an API key to continue.');
      return;
    }
    if (custom) {
      const parsed = URL.parse(endpoint);
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        setError('Enter a valid HTTP or HTTPS base URL, such as http://localhost:11434/v1.');
        return;
      }
    }

    const needsVerification = adding || connectionChanged || provider.status !== 'connected';

    if (!needsVerification) {
      onSave(models);
      return;
    }

    const attempt = Symbol();
    pending.current = attempt;
    setChecking(true);
    const connection = { ...provider, ...models, apiKey: key, baseUrl: custom ? endpoint : provider.baseUrl };
    const result = await testProviderConnection(connection);
    if (pending.current !== attempt) return;
    pending.current = null;
    setChecking(false);

    if (!result.ok) {
      const message = key
        ? result.message.replaceAll(key, '[redacted]').replaceAll(encodeURIComponent(key), '[redacted]')
        : result.message;
      setError(message || 'Could not verify this connection.');
      return;
    }

    onSave({
      ...connection,
      sttModel: adding ? initialModel(models.sttModel, result.models?.speech) : models.sttModel,
      llmModel: adding ? initialModel(models.llmModel, result.models?.ai) : models.llmModel,
      discoveredModels: result.models ?? (connectionChanged ? undefined : provider.discoveredModels),
      status: 'connected',
      statusMessage: undefined,
      lastTestedAt: new Date().toISOString(),
    });
  }

  return (
    <>
      <form onSubmit={submit} className="provider-form">
        <fieldset disabled={busy} aria-busy={busy}>
          {custom && (
            <div className="provider-field">
              <label htmlFor="provider-endpoint">Base URL</label>
              <input id="provider-endpoint" type="text" inputMode="url" value={baseUrl} spellCheck={false} onChange={(event) => { setBaseUrl(event.target.value); setError(''); setRefreshMessage(''); }} />
            </div>
          )}
          <div className="provider-field">
            <div className="provider-field-label">
              <label htmlFor="provider-api-key">API key {custom && <span>(optional)</span>}</label>
              <a href={meta.docsUrl} target="_blank" rel="noreferrer">Get an API key <ArrowUpRight size={13} aria-hidden="true" /></a>
            </div>
            <div className="provider-key-input">
              <input
                id="provider-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder={meta.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => { setApiKey(event.target.value); setError(''); setRefreshMessage(''); }}
              />
              <button type="button" className="provider-reveal" aria-label={showKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {!adding && (
            <>
              <div className="provider-model-header">
                <h3>Models</h3>
                <button
                  type="button"
                  className="provider-refresh"
                  aria-label={refreshing ? 'Refreshing models' : 'Refresh models'}
                  title="Refresh models"
                  disabled={busy || connectionChanged}
                  onClick={refreshModels}
                >
                  <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
                </button>
              </div>
              <div className="provider-models">
                {meta.supportsStt && (
                  <ModelField id="provider-speech-model" label="Speech model" help="Turns your recorded speech into text." value={sttModel} options={discovered?.speech.length ? discovered.speech : custom ? [] : meta.sttModels} onChange={setSttModel} />
                )}
                {meta.supportsLlm && (
                  <ModelField id="provider-ai-model" label="AI model" help="Cleans up transcripts when Smart Cleanup is enabled, translates text, and answers Ask Anything requests." value={llmModel} options={discovered?.ai.length ? discovered.ai : custom ? [] : meta.llmModels} onChange={setLlmModel} />
                )}
              </div>
              {connectionChanged && <p className="provider-model-note">Save the connection to load models for the new credentials.</p>}
              <p className="provider-model-note" role="status">{refreshMessage}</p>
            </>
          )}
        </fieldset>

        {error && <p className="provider-error" role="alert">{error}</p>}
        <div className="provider-form-actions">
          {onRemove && (
            <button
              type="button"
              className="provider-remove"
              disabled={busy}
              onClick={() => {
                removalDialog.current?.showModal();
                keepProviderButton.current?.focus();
              }}
            >
              Remove provider
            </button>
          )}
          <button type="button" className="provider-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="provider-primary" disabled={busy}>
            {checking && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {checking ? 'Verifying…' : adding ? 'Verify & add' : 'Save changes'}
          </button>
        </div>
      </form>
      {onRemove && (
        <dialog
          ref={removalDialog}
          className="yy-language-dialog provider-removal-dialog"
          aria-labelledby={removalTitleId}
          aria-describedby={removalDescriptionId}
          onCancel={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="yy-language-close"
            aria-label="Close removal confirmation"
            onClick={() => removalDialog.current?.close()}
          >
            <X size={14} aria-hidden="true" />
          </button>
          <header>
            <h2 id={removalTitleId}>Remove {meta.name}?</h2>
            <p id={removalDescriptionId}>This deletes the saved connection and API key from this device.</p>
          </header>
          <div className="provider-remove-confirm">
            <button ref={keepProviderButton} type="button" className="provider-secondary" onClick={() => removalDialog.current?.close()}>
              Cancel
            </button>
            <button type="button" className="provider-remove-confirm-button" onClick={onRemove}>
              Remove
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

function initialModel(preferred: string, options?: ProviderModel[]): string {
  return options?.length && !options.some((model) => model.id === preferred) ? options[0].id : preferred;
}

function ModelField({ id, label, help, value, options, onChange }: {
  id: string;
  label: string;
  help: string;
  value: string;
  options: ProviderModel[];
  onChange: (value: string) => void;
}) {
  const [manual, setManual] = useState(false);
  const showInput = manual || !options.length;
  const choices = options.map((model) => ({
    value: model.id,
    label: model.label.includes(model.id) ? model.label : `${model.label} · ${model.id}`,
  }));
  if (value && !choices.some((option) => option.value === value)) choices.unshift({ value, label: value });

  return (
    <div className="provider-field">
      <div className="provider-field-label">
        <div className="provider-model-label">
          <label htmlFor={id}>{label}</label>
          <span className="provider-model-help" tabIndex={0} aria-label={`${label}. ${help}`} data-tooltip={help}>
            <Info size={14} aria-hidden="true" />
          </span>
        </div>
        {options.length > 0 && (
          <button type="button" className="provider-model-mode" onClick={() => setManual(!manual)}>
            {manual ? 'Choose model' : 'Enter ID'}
          </button>
        )}
      </div>
      {showInput ? (
        <input id={id} type="text" value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <SelectMenu id={id} label={label} value={value} options={choices} onChange={onChange} />
      )}
    </div>
  );
}
