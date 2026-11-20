// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UpdateController, type UpdateDeps, type UpdateState } from '../../electron/updateController';
import { UpdateCard } from '../components/UpdateCard';
import { UpdateDialog } from '../components/UpdateDialog';

function controller(overrides: Partial<UpdateDeps> = {}) {
  const states: UpdateState[] = [];
  const deps: UpdateDeps = {
    currentVersion: '1.0.1',
    inPlace: true,
    checkInPlace: vi.fn(async () => '1.0.2'),
    downloadInPlace: vi.fn(async (onPercent) => { onPercent(42.4); onPercent(100); }),
    installInPlace: vi.fn(),
    checkRelease: vi.fn(async () => ({ message: '' })),
    downloadInstaller: vi.fn(async () => '/Downloads/Yap-Yap-1.0.2-macos-arm64.dmg'),
    revealFile: vi.fn(),
    openUrl: vi.fn(),
    readSkipped: vi.fn(async () => ''),
    writeSkipped: vi.fn(async () => undefined),
    onChange: (state) => states.push(state),
    ...overrides,
  };
  return { updates: new UpdateController(deps), deps, states };
}

describe('UpdateController', () => {
  it('offers, downloads with progress, and restarts into an in-place update', async () => {
    const { updates, deps, states } = controller();
    expect(await updates.check()).toEqual({ status: 'available', version: '1.0.2', method: 'install' });
    await updates.download();
    expect(states).toContainEqual({ status: 'downloading', version: '1.0.2', percent: 42 });
    expect(updates.state).toEqual({ status: 'ready', version: '1.0.2', method: 'install' });
    updates.install();
    expect(deps.installInPlace).toHaveBeenCalledOnce();
  });

  it('stays quiet at startup about a version the user put off, but a manual check still offers it', async () => {
    const { updates, deps } = controller({ readSkipped: vi.fn(async () => '1.0.2') });
    expect(await updates.check(true)).toEqual({ status: 'idle' });
    expect((await updates.check()).status).toBe('available');
    await updates.dismiss();
    expect(deps.writeSkipped).toHaveBeenCalledWith('1.0.2');
    expect(updates.state).toEqual({ status: 'idle' });
  });

  it('keeps startup silent when offline, and reports a failed manual check', async () => {
    const { updates } = controller({ checkInPlace: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await updates.check(true)).toEqual({ status: 'idle' });
    expect((await updates.check()).status).toBe('error');
  });

  it('saves and reveals the installer on macOS, and lets a failed download be retried', async () => {
    const installer = { name: 'Yap-Yap-1.0.2-macos-arm64.dmg', url: 'https://example.invalid', digest: 'sha256:x', size: 1 };
    const downloadInstaller = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('/Downloads/Yap-Yap-1.0.2-macos-arm64.dmg');
    const { updates, deps } = controller({
      inPlace: false,
      checkRelease: vi.fn(async () => ({ message: '', version: '1.0.2', installer })),
      downloadInstaller,
    });
    expect(await updates.check()).toEqual({ status: 'available', version: '1.0.2', method: 'download' });
    await updates.download();
    expect(updates.state).toMatchObject({ status: 'error', version: '1.0.2' });
    await updates.download();
    expect(updates.state).toEqual({ status: 'ready', version: '1.0.2', method: 'download' });
    expect(deps.revealFile).toHaveBeenCalledWith('/Downloads/Yap-Yap-1.0.2-macos-arm64.dmg');
  });

  it('opens the release page when the release has no installer for this computer', async () => {
    const { updates, deps } = controller({
      inPlace: false,
      checkRelease: vi.fn(async () => ({ message: '', version: '1.0.2', url: 'https://github.com/releases/latest' })),
    });
    expect((await updates.check()).status).toBe('available');
    await updates.download();
    expect(deps.openUrl).toHaveBeenCalledWith('https://github.com/releases/latest');
  });
});

describe('UpdateCard', () => {
  afterEach(() => {
    cleanup();
    delete (window as { yapyap?: unknown }).yapyap;
  });

  function mountWith(state: UpdateState) {
    let emit: (state: UpdateState) => void = () => undefined;
    const updates = {
      get: vi.fn(async () => state),
      check: vi.fn(),
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      dismiss: vi.fn(async () => undefined),
      onState: (cb: (state: UpdateState) => void) => { emit = cb; return () => undefined; },
    };
    (window as unknown as { yapyap: unknown }).yapyap = { updates };
    render(<UpdateCard />);
    return { updates, emit: (next: UpdateState) => act(() => emit(next)) };
  }

  it('walks from Download through progress to Restart now', async () => {
    const { updates, emit } = mountWith({ status: 'available', version: '1.0.2', method: 'install' });
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }));
    expect(updates.download).toHaveBeenCalledOnce();

    emit({ status: 'downloading', version: '1.0.2', percent: 42 });
    expect(screen.getByRole('progressbar', { name: 'Download progress' }).getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByRole('status').textContent).toBe('Downloading v1.0.2…42%');

    emit({ status: 'ready', version: '1.0.2', method: 'install' });
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(updates.install).toHaveBeenCalledOnce();
  });

  it('puts an offer off with Later and shows nothing when there is no update', async () => {
    const { updates, emit } = mountWith({ status: 'available', version: '1.0.2', method: 'install' });
    await userEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(updates.dismiss).toHaveBeenCalledOnce();
    emit({ status: 'up-to-date', version: '1.0.2' });
    expect(screen.queryByRole('region', { name: 'App update' })).toBeNull();
  });
});

describe('UpdateDialog', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
  });
  afterEach(() => {
    cleanup();
    delete (window as { yapyap?: unknown }).yapyap;
  });

  function open(result: UpdateState, initial: UpdateState = { status: 'idle' }) {
    let emit: (state: UpdateState) => void = () => undefined;
    let answer: (state: UpdateState) => void = () => undefined;
    const updates = {
      get: vi.fn(async () => initial),
      check: vi.fn(() => new Promise<UpdateState>((resolve) => { answer = resolve; })),
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      dismiss: vi.fn(async () => undefined),
      onState: (cb: (state: UpdateState) => void) => { emit = cb; return () => undefined; },
    };
    (window as unknown as { yapyap: unknown }).yapyap = { updates };
    const onClose = vi.fn();
    render(<UpdateDialog onClose={onClose} />);
    const finish = () => act(async () => { emit(result); answer(result); });
    return { updates, onClose, emit: (next: UpdateState) => act(() => emit(next)), finish };
  }

  it('checks as it opens and says when Yap Yap is up to date', async () => {
    const { updates, onClose, finish } = open({ status: 'up-to-date', version: '1.0.2' }, { status: 'up-to-date', version: '1.0.1' });
    expect(updates.check).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Checking for updates…' })).toBeTruthy();
    await finish();
    expect(screen.getByRole('heading', { name: 'You’re up to date!' })).toBeTruthy();
    expect(screen.getByText('Yap Yap 1.0.2 is the newest version available.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers an update, shows download progress, then restarts into it', async () => {
    const { updates, emit, finish } = open({ status: 'available', version: '1.0.3', method: 'install' });
    await finish();
    expect(screen.getByRole('heading', { name: 'Yap Yap 1.0.3 is available' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(updates.download).toHaveBeenCalledOnce();

    emit({ status: 'downloading', version: '1.0.3', percent: 64 });
    expect(screen.getByRole('progressbar', { name: 'Download progress' }).getAttribute('aria-valuenow')).toBe('64');
    expect(screen.getByText('64%')).toBeTruthy();

    emit({ status: 'ready', version: '1.0.3', method: 'install' });
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(updates.install).toHaveBeenCalledOnce();
  });

  it('opens straight to a download already in progress', async () => {
    open({ status: 'downloading', version: '1.0.3', percent: 30 }, { status: 'downloading', version: '1.0.3', percent: 30 });
    expect(await screen.findByRole('heading', { name: 'Downloading Yap Yap 1.0.3' })).toBeTruthy();
  });

  it('puts an offer off with Later and lets a failed check be retried', async () => {
    const first = open({ status: 'available', version: '1.0.3', method: 'install' });
    await first.finish();
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(first.updates.dismiss).toHaveBeenCalledOnce();
    expect(first.onClose).toHaveBeenCalledOnce();
    cleanup();

    const second = open({ status: 'error', message: 'Couldn’t check for updates. Try again later.' });
    await second.finish();
    expect(screen.getByRole('heading', { name: 'Couldn’t check for updates' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(second.updates.check).toHaveBeenCalledTimes(2);
  });
});
