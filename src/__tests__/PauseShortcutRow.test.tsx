import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PauseShortcutRow } from '../components/SettingsModal';

it('shows holding the shortcut to pause, with nothing to edit', () => {
  const html = renderToStaticMarkup(<PauseShortcutRow combo={['Right Alt']} />);
  expect(html).toContain('Pause and resume');
  expect(html).toContain('Hold');
  expect(html).toContain('Right Alt');
  expect(html).not.toContain('<button');
});
