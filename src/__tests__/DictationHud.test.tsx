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
      onPause={noop}
      onResume={noop}
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

it('marks an Ask answer that searched the web', () => {
  const searched = renderHud({ status: 'result', mode: 'ask', levels: [], resultText: 'Answer.', searchedWeb: true });
  const known = renderHud({ status: 'result', mode: 'ask', levels: [], resultText: 'Answer.' });
  expect(searched).toContain('Searched the web');
  expect(known).not.toContain('Searched the web');
});

function renderHud(hud: Parameters<typeof DictationHud>[0]['hud']) {
  const noop = vi.fn();
  return renderToStaticMarkup(
    <DictationHud hud={hud} onStop={noop} onCancel={noop} onPause={noop} onResume={noop} onUndo={noop} onRetry={noop}
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

it('draws a countdown ring around Undo', () => {
  const html = renderHud({ status: 'cancelled', mode: 'dictate', levels: [] });
  expect(html).toMatch(/<button[^>]*>.*class="yy-hud-undo-ring".*Undo<\/button>|<button[^>]*>Undo.*class="yy-hud-undo-ring".*<\/button>/s);
});

it('offers Pause next to Finish while recording', () => {
  const html = renderHud({ status: 'recording', mode: 'dictate', levels: [] });
  expect(html).toContain('aria-label="Pause recording"');
  expect(html).toContain('aria-label="Finish recording"');
});

it('shows a compact paused pill with Resume', () => {
  const hud = { status: 'recording' as const, mode: 'dictate' as const, levels: [], paused: true };
  expect(pillStateFor(hud)).toBe('paused');
  const html = renderHud(hud);
  expect(html).toContain('data-state="paused"');
  expect(html).toContain('Paused');
  expect(html).toContain('aria-label="Resume recording"');
  expect(html).toMatch(/<button[^>]*aria-label="Pause recording"[^>]*disabled|<button[^>]*disabled[^>]*aria-label="Pause recording"/);
});

it('shows how to pause above the recording pill', () => {
  const html = renderHud({ status: 'recording', mode: 'dictate', levels: [], pauseTip: { keys: ['Right Alt'] } });
  expect(html).toContain('yy-hud-tip');
  expect(html).toMatch(/Hold <kbd>Right Alt<\/kbd> to pause/);
  // Finish is drawn as a small copy of the real button, not a text ✓.
  expect(html).toMatch(/hover <span class="yy-hud-tip-finish" aria-label="Finish"[^>]*><svg[^]*<\/span> and click <svg[^>]*class="yy-hud-tip-pause"[^>]*aria-label="Pause"[^]*?<\/svg><\/p>/);
  expect(html).not.toContain('✓');
  expect(html).not.toContain('click pause');
  expect(html.indexOf('yy-hud-tip')).toBeLessThan(html.indexOf('data-state="recording"'));
});

it('leaves out holding when no shortcut can be held', () => {
  const html = renderHud({ status: 'recording', mode: 'dictate', levels: [], pauseTip: {} });
  expect(html).not.toContain('Hold');
  expect(html).toMatch(/Hover <span class="yy-hud-tip-finish"[^]*<\/span> and click <svg[^>]*class="yy-hud-tip-pause"[^]*?<\/svg> to pause the recording/);
});
