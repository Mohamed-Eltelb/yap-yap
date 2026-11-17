import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { DictationHud, pillStateFor } from '../components/DictationHud';

it('renders Markdown formatting in an Ask answer', () => {
  const noop = vi.fn();
  const html = renderToStaticMarkup(
    <DictationHud
      hud={{ status: 'result', mode: 'ask', levels: [], resultText: '**First** paragraph.\n\n**Second** paragraph.' }}
      onStop={noop}
      onCancel={noop}
      onUndo={noop}
      onRetry={noop}
      onSelectTarget={noop}
      onEditTargets={noop}
      onCopyResult={noop}
      onDismissResult={noop}
    />,
  );

  expect(html).toContain('<p><strong>First</strong> paragraph.</p>');
  expect(html).toContain('<p><strong>Second</strong> paragraph.</p>');
});

function renderHud(hud: Parameters<typeof DictationHud>[0]['hud']) {
  const noop = vi.fn();
  return renderToStaticMarkup(
    <DictationHud hud={hud} onStop={noop} onCancel={noop} onUndo={noop} onRetry={noop}
      onSelectTarget={noop} onEditTargets={noop} onCopyResult={noop} onDismissResult={noop} />,
  );
}

it('shows an empty placeholder while a shortcut is pressed', () => {
  const html = renderHud({ status: 'armed', mode: 'dictate', levels: [] });
  expect(html).toContain('Waiting for shortcut');
  // The buttons wait hidden in the pill, out of reach until recording starts.
  expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Finish recording"|<button[^>]*aria-label="Finish recording"[^>]*disabled/);
});

it('lists the shortcuts while the key is held', () => {
  const html = renderHud({
    status: 'armed', mode: 'dictate', levels: [],
    shortcutList: [
      { mode: 'dictate', combos: [['Right Alt']] },
      { mode: 'translate', combos: [['Right Alt', 'Right Shift']] },
      { mode: 'ask', combos: [['Right Alt', 'Space']] },
    ],
  });
  expect(html).toContain('Dictate');
  expect(html).toContain('Right Alt + Right Shift');
  expect(html).toContain('Ask anything');
});

it('tells the user the last dictation is still processing', () => {
  const html = renderHud({ status: 'processing', mode: 'dictate', levels: [], busyNotice: true });
  expect(html).toContain('Yap Yap is still processing your last dictation');
  expect(html).toContain('Press Esc or click Cancel to cancel it.');
  expect(html).toMatch(/<button[^>]*>Cancel<\/button>/);
  // The notice sits above the Thinking pill rather than replacing it.
  expect(html.indexOf('yy-hud-busy')).toBeLessThan(html.indexOf('data-state="thinking"'));
  expect(html).toContain('Thinking');
});

it('says no speech was detected', () => {
  const html = renderHud({ status: 'notice', mode: 'dictate', levels: [], noticeText: 'No speech detected' });
  expect(html).toContain('No speech detected');
});

it('uses one pill for waiting, recording and thinking', () => {
  expect(renderHud({ status: 'armed', mode: 'dictate', levels: [] })).toContain('data-state="armed"');
  expect(renderHud({ status: 'recording', mode: 'dictate', levels: [] })).toContain('data-state="recording"');
  const thinking = renderHud({ status: 'processing', mode: 'dictate', levels: [] });
  expect(thinking).toContain('data-state="thinking"');
  expect(thinking).toContain('Thinking');
  expect(thinking.match(/class="yy-hud-pill"/g)).toHaveLength(1);
});

it('keeps the recording buttons out of reach while thinking', () => {
  const html = renderHud({ status: 'processing', mode: 'dictate', levels: [] });
  expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Finish recording"|<button[^>]*aria-label="Finish recording"[^>]*disabled/);
});

it('maps HUD states to pill states', () => {
  expect(pillStateFor({ status: 'armed', mode: 'dictate', levels: [] })).toBe('armed');
  expect(pillStateFor({ status: 'processing', mode: 'dictate', levels: [] })).toBe('thinking');
  expect(pillStateFor({ status: 'armed', mode: 'dictate', levels: [], shortcutList: [] })).toBeUndefined();
  expect(pillStateFor({ status: 'result', mode: 'dictate', levels: [] })).toBeUndefined();
});
