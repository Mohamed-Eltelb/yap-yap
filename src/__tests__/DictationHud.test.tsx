import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { DictationHud } from '../components/DictationHud';

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
  expect(html).not.toContain('Finish recording');
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
});
