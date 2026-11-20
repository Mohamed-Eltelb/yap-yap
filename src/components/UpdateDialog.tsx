import { useEffect, useState } from 'react';
import { SettingsSubdialog } from './SettingsSubdialog';
import { UpdateProgress, useAppUpdate } from './UpdateCard';

const primary =
  'px-4 py-1.5 rounded-full bg-[var(--accent-blue-fill)] hover:bg-[var(--accent-blue-hover)] text-white text-[13px] font-medium transition-colors';
const secondary =
  'px-4 py-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-card-solid)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] transition-colors';

/**
 * Check for updates: checks as it opens, then offers the update, downloads it with progress,
 * and restarts into it. It follows the same state as the sidebar card, so closing it while a
 * download runs leaves the card showing the progress.
 */
export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const latest = useAppUpdate();
  const updates = window.yapyap?.updates;
  // Until this check answers, an earlier result (say "up to date") would be stale.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void updates?.check().finally(() => { if (active) setChecked(true); });
    return () => { active = false; };
  }, [updates]);

  const state = checked || latest.status === 'downloading' || latest.status === 'ready'
    ? latest
    : { status: 'checking' as const };

  let title = 'Checking for updates…';
  let description = 'Looking for a newer version of Yap Yap.';
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;

  switch (state.status) {
    case 'up-to-date':
      title = 'You’re up to date!';
      description = `Yap Yap ${state.version} is the newest version available.`;
      actions = <button type="button" className={primary} onClick={onClose}>Got it</button>;
      break;
    case 'available':
      title = `Yap Yap ${state.version} is available`;
      description = state.method === 'install'
        ? 'Download it now. You choose when Yap Yap restarts to install it.'
        : state.method === 'download'
          ? 'Download the installer to your Downloads folder, then open it to update.'
          : 'This version doesn’t have an installer for your computer yet. See the release on GitHub.';
      actions = (
        <>
          <button
            type="button"
            className={secondary}
            onClick={() => { void updates?.dismiss(); onClose(); }}
          >
            Later
          </button>
          <button type="button" className={primary} onClick={() => void updates?.download()}>
            {state.method === 'page' ? 'View release' : 'Download'}
          </button>
        </>
      );
      break;
    case 'downloading':
      title = `Downloading Yap Yap ${state.version}`;
      description = 'You can close this window. The download continues, and the sidebar shows its progress.';
      body = (
        <div className="space-y-1.5">
          <UpdateProgress percent={state.percent} />
          <div className="text-[12px] tabular-nums text-[var(--text-secondary)]">{state.percent}%</div>
        </div>
      );
      actions = <button type="button" className={secondary} onClick={onClose}>Hide</button>;
      break;
    case 'ready':
      title = `Yap Yap ${state.version} is ready`;
      if (state.method === 'install') {
        description = 'Restart to finish updating, or it installs when you quit Yap Yap from the tray.';
        actions = (
          <>
            <button type="button" className={secondary} onClick={onClose}>Later</button>
            <button type="button" className={primary} onClick={() => void updates?.install()}>Restart now</button>
          </>
        );
      } else {
        description = 'The installer is in your Downloads folder. Open it to update Yap Yap.';
        actions = (
          <>
            <button type="button" className={secondary} onClick={onClose}>Close</button>
            <button type="button" className={primary} onClick={() => void updates?.install()}>Show installer</button>
          </>
        );
      }
      break;
    case 'error':
      title = state.version ? 'Download failed' : 'Couldn’t check for updates';
      description = state.message;
      actions = (
        <>
          <button type="button" className={secondary} onClick={onClose}>Close</button>
          <button
            type="button"
            className={primary}
            onClick={() => void (state.version ? updates?.download() : updates?.check())}
          >
            Try again
          </button>
        </>
      );
      break;
  }

  return (
    <SettingsSubdialog title={title} description={description} onClose={onClose}>
      <div className="px-[22px] pb-5 space-y-4" aria-live="polite">
        {body}
        {actions && <div className="flex justify-end gap-2">{actions}</div>}
      </div>
    </SettingsSubdialog>
  );
}
