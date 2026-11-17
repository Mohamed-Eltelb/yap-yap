// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { StartingStylesDialog } from '../components/StartingStylesDialog';
import { STYLE_PRESETS } from '../services/personalization';

const [formal, , veryCasual] = STYLE_PRESETS;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
  HTMLElement.prototype.showPopover = function showPopover() {};
  HTMLElement.prototype.hidePopover = function hidePopover() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  document.elementFromPoint = () => document.activeElement;
});
afterEach(cleanup);

it('saves a picked style and goes back to learning', async () => {
  const onChange = vi.fn();
  const corrections = { Email: { tone: formal.tone, phrasing: formal.phrasing, since: '2026-01-01T00:00:00.000Z' } };
  const onDefaultChange = vi.fn();
  render(<StartingStylesDialog corrections={corrections} defaultStyle="" active onChange={onChange} onDefaultChange={onDefaultChange} onClose={vi.fn()} />);
  const user = userEvent.setup();
  const pick = async (category: string, option: RegExp | string) => {
    const menu = screen.getByRole('combobox', { name: `Writing style for ${category}` });
    await user.click(menu);
    await user.click(within(document.getElementById(menu.getAttribute('aria-controls')!)!).getByRole('option', { name: option, hidden: true }));
  };

  expect(screen.getByRole('combobox', { name: 'Writing style for Email' }).textContent).toContain('Formal');
  await pick('Messaging', /Very casual/);
  expect(onChange).toHaveBeenLastCalledWith({
    ...corrections,
    Messaging: { tone: veryCasual.tone, phrasing: veryCasual.phrasing, since: expect.any(String) },
  });

  await pick('Email', 'Learn from me');
  expect(onChange).toHaveBeenLastCalledWith({});

  const defaults = screen.getByRole('radiogroup', { name: 'Default style' });
  expect((within(defaults).getByRole('radio', { name: /Learn from me/ }) as HTMLInputElement).checked).toBe(true);
  await user.click(within(defaults).getByRole('radio', { name: /^Casual/ }));
  expect(onDefaultChange).toHaveBeenLastCalledWith('casual');
});
