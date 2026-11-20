// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { isMicrophoneMissing, MicrophoneDialog } from '../components/MicrophoneDialog';

type Frame = { levels: number[]; peak: number };
const test = vi.hoisted(() => ({
  onFrame: undefined as ((frame: Frame) => void) | undefined,
  close: vi.fn(),
  start: vi.fn(),
}));

vi.mock('../utils/audioRecorder', () => ({
  startMicrophoneTest: (...args: unknown[]) => {
    test.onFrame = args[1] as (frame: Frame) => void;
    return test.start(...args);
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
});
beforeEach(() => {
  test.onFrame = undefined;
  test.close.mockReset();
  test.start.mockReset().mockResolvedValue(test.close);
});
afterEach(cleanup);

const microphones = [
  { id: 'default', label: 'Default - Microphone (Realtek Audio)' },
  { id: 'communications', label: 'Communications - Microphone (Realtek Audio)' },
  { id: 'realtek', label: 'Microphone (Realtek Audio)' },
  { id: 'airpods', label: 'Headset (AirPods Pro)' },
];

function renderDialog(props: Partial<Parameters<typeof MicrophoneDialog>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <MicrophoneDialog
      microphones={microphones}
      devicesKnown
      value="default"
      strongNoiseReduction={false}
      onChange={onChange}
      onClose={vi.fn()}
      {...props}
    />,
  );
  return { onChange, ...view };
}

const frames = (count: number, level: number, peak: number) => act(() => {
  for (let i = 0; i < count; i++) test.onFrame?.({ levels: Array(20).fill(level), peak });
});

it('lists the microphones, names the system default, and hides the Windows duplicate', () => {
  renderDialog();
  const radios = screen.getAllByRole('radio');
  expect(radios.map((radio) => radio.textContent)).toEqual([
    'Auto-detectUsing Microphone (Realtek Audio)',
    'Microphone (Realtek Audio)',
    'Headset (AirPods Pro)',
  ]);
  expect(radios[0].getAttribute('aria-checked')).toBe('true');
});

it('chooses a microphone by click and by arrow keys', () => {
  const { onChange, rerender } = renderDialog();
  fireEvent.click(screen.getByRole('radio', { name: /AirPods/ }));
  expect(onChange).toHaveBeenLastCalledWith('airpods');

  fireEvent.keyDown(screen.getByRole('radio', { name: /Auto-detect/ }), { key: 'ArrowDown' });
  expect(onChange).toHaveBeenLastCalledWith('realtek');
  fireEvent.keyDown(screen.getByRole('radio', { name: /Auto-detect/ }), { key: 'ArrowUp' });
  expect(onChange).toHaveBeenLastCalledWith('airpods');
  fireEvent.keyDown(screen.getByRole('radio', { name: /Auto-detect/ }), { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith('airpods');

  rerender(
    <MicrophoneDialog microphones={microphones} devicesKnown value="airpods" strongNoiseReduction={false} onChange={onChange} onClose={vi.fn()} />,
  );
  // Only the chosen microphone is in the tab order.
  expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);
});

it('tests the chosen microphone through the noise filter dictation uses, and closes it after', async () => {
  const { unmount } = renderDialog({ value: 'realtek', strongNoiseReduction: true });
  expect(test.start).toHaveBeenCalledWith('realtek', expect.any(Function), { strongNoiseReduction: true });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Start yapping…'));
  unmount();
  expect(test.close).toHaveBeenCalled();
});

it('says loud and clear when it hears a voice, and warns when the voice stays quiet', async () => {
  renderDialog();
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Start yapping…'));

  frames(72, 0.15, 4);
  expect(screen.getByRole('status').textContent).toMatch(/A bit quiet/);

  frames(5, 0.8, 60);
  expect(screen.getByRole('status').textContent).toBe('Loud and clear!');

  // Silence afterwards keeps the verdict instead of asking again.
  frames(150, 0, 0);
  expect(screen.getByRole('status').textContent).toBe('Loud and clear!');
});

it('says so when the microphone cannot open', async () => {
  test.start.mockRejectedValue(new Error('NotAllowedError'));
  renderDialog();
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Can’t hear a thing/));
});

it('shows a saved microphone that is unplugged instead of hiding it', () => {
  renderDialog({ value: 'yeti' });
  const saved = screen.getByRole('radio', { name: /Saved microphone/ });
  expect(saved.getAttribute('aria-checked')).toBe('true');
  expect(saved.textContent).toMatch(/Not connected/);
  expect(screen.getByRole('status').textContent).toMatch(/isn’t connected/);
  expect(test.start).not.toHaveBeenCalled();
});

it('only calls a microphone missing once the system has named its devices', () => {
  expect(isMicrophoneMissing('yeti', [], false)).toBe(false);
  expect(isMicrophoneMissing('yeti', microphones, true)).toBe(true);
  expect(isMicrophoneMissing('default', [], true)).toBe(false);
  expect(isMicrophoneMissing('airpods', microphones, true)).toBe(false);
});
