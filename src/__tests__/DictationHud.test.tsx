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
