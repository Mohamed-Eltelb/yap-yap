import { useEffect, useState } from 'react';
import { ArrowDownToLine, RotateCw, X } from 'lucide-react';
import type { UpdateState } from '../../electron/updateController';

/** The desktop update state, kept current from the main process. Idle in the browser preview. */
export function useAppUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  useEffect(() => {
    const updates = window.yapyap?.updates;
    if (!updates) return;
    let active = true;
    // A change the main process sends is newer than the snapshot `get` returns.
    let heardChange = false;
    const unsubscribe = updates.onState((next) => {
      heardChange = true;
      setState(next);
    });
    void updates.get().then((current) => {
      if (active && current && !heardChange) setState(current);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state;
}

export function UpdateProgress({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Download progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 rounded-full bg-[var(--bg-subtle)] dark:bg-black/25 overflow-hidden"
    >
      <div className="h-full rounded-full bg-[var(--accent-blue-fill)] transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
  );
}

const primaryButton =
  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--accent-blue-fill)] hover:bg-[var(--accent-blue-hover)] text-white text-[12px] font-medium transition-colors';
const quietButton =
  'px-2 py-1 rounded-full text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors';

/** The sidebar's update offer: Download, then progress, then Restart to update. */
export function UpdateCard() {
  const state = useAppUpdate();
  const updates = window.yapyap?.updates;
  if (!updates) return null;

  let title: React.ReactNode;
  let detail: React.ReactNode = null;
  let actions: React.ReactNode = null;
  let dismissable = false;

  switch (state.status) {
    case 'available':
      title = `Yap Yap v${state.version} is available`;
      actions = (
        <>
          <button type="button" className={primaryButton} onClick={() => void updates.download()}>
            <ArrowDownToLine size={13} aria-hidden="true" />
            {state.method === 'page' ? 'View release' : 'Download'}
          </button>
          <button type="button" className={quietButton} onClick={() => void updates.dismiss()}>
            Later
          </button>
        </>
      );
      break;
    case 'downloading':
      title = (
        <span className="flex items-baseline justify-between gap-2">
          <span>Downloading v{state.version}…</span>
          <span className="tabular-nums text-[var(--text-secondary)]">{state.percent}%</span>
        </span>
      );
      detail = <UpdateProgress percent={state.percent} />;
      break;
    case 'ready':
      if (state.method === 'install') {
        title = `Yap Yap v${state.version} is ready`;
        detail = 'Restart to finish updating, or it installs when you quit Yap Yap from the tray.';
        actions = (
          <button type="button" className={primaryButton} onClick={() => void updates.install()}>
            <RotateCw size={13} aria-hidden="true" />
            Restart now
          </button>
        );
      } else {
        title = `v${state.version} is in Downloads`;
        detail = 'Open the installer to update Yap Yap.';
        dismissable = true;
        actions = (
          <button type="button" className={primaryButton} onClick={() => void updates.install()}>
            Show installer
          </button>
        );
      }
      break;
    case 'error':
      if (!state.version) return null;
      title = 'Update download failed';
      detail = state.message;
      dismissable = true;
      actions = (
        <button type="button" className={primaryButton} onClick={() => void updates.download()}>
          Try again
        </button>
      );
      break;
    default:
      return null;
  }

  return (
    <section
      aria-label="App update"
      className="relative p-3 rounded-[14px] bg-[var(--bg-card-solid)] shadow-xs space-y-2"
    >
      <div role="status" className="pe-4 text-[12.5px] font-semibold leading-snug text-[var(--text-primary)]">
        {title}
      </div>
      {typeof detail === 'string' ? (
        <p className="text-[11.5px] leading-snug text-[var(--text-secondary)]">{detail}</p>
      ) : detail}
      {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      {dismissable && (
        <button
          type="button"
          onClick={() => void updates.dismiss()}
          aria-label="Dismiss update"
          className="absolute top-2 right-2 p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
