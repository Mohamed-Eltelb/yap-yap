import { describe, expect, it } from 'vitest';
import { MAC_FIELD_LIMIT, macProbe, parseMacContext, parseMacField } from '../../electron/macContext';
import { browserDomain } from '../../electron/dictationContext';

type Attributes = Record<string, unknown>;

/** Runs the probe script against a fake System Events and fake browsers. */
function runProbe(command: 'context' | 'field', { app, address, field, launched = [] as string[] }: {
  app?: string; address?: string; field?: Attributes; launched?: string[];
}) {
  const element = field && {
    attributes: { byName: (name: string) => ({ value: () => { if (!(name in field)) throw new Error('no attribute'); return field[name]; } }) },
  };
  const process = {
    name: () => { if (!app) throw new Error('no access'); return app; },
    unixId: () => 4242,
    attributes: { byName: (name: string) => ({ value: () => { if (name !== 'AXFocusedUIElement' || !element) throw new Error('none'); return element; } }) },
  };
  const tab = { url: () => { if (address === undefined) throw new Error('no window'); return address; } };
  const Application = (name: string) => {
    if (name === 'System Events') return { processes: { whose: () => [process] } };
    launched.push(name);
    return { windows: [{ currentTab: tab, activeTab: tab }] };
  };
  return new Function('Application', `${macProbe(command)}\nreturn run();`)(Application) as string;
}

describe('Mac context probe', () => {
  it('reads the frontmost app and a known browser\'s address', () => {
    expect(parseMacContext(runProbe('context', { app: 'Safari', address: 'https://mail.google.com/mail/u/0' })))
      .toEqual({ application: 'Safari', address: 'https://mail.google.com/mail/u/0' });
    expect(parseMacContext(runProbe('context', { app: 'Google Chrome', address: 'https://docs.google.com/spreadsheets/d/1' })))
      .toEqual({ application: 'Google Chrome', address: 'https://docs.google.com/spreadsheets/d/1' });
    expect(browserDomain('https://docs.google.com/spreadsheets/d/1')).toBe('sheets.google.com');
  });

  it('never sends Apple events to apps that are not known browsers', () => {
    const launched: string[] = [];
    expect(parseMacContext(runProbe('context', { app: 'Slack', address: 'x', launched }))).toEqual({ application: 'Slack' });
    expect(parseMacContext(runProbe('context', { app: 'Firefox', address: 'x', launched }))).toEqual({ application: 'Firefox' });
    expect(launched).toEqual([]);
  });

  it('keeps the app name when a browser has no window or refuses access', () => {
    expect(parseMacContext(runProbe('context', { app: 'Arc' }))).toEqual({ application: 'Arc' });
  });

  it('returns nothing without Accessibility access', () => {
    expect(parseMacContext(runProbe('context', {}))).toBeUndefined();
    expect(parseMacField(runProbe('field', {}))).toBeUndefined();
  });

  it('caps a long address', () => {
    const output = runProbe('context', { app: 'Safari', address: `https://example.com/${'a'.repeat(5000)}` });
    expect(parseMacContext(output)?.address).toHaveLength(2048);
  });
});

describe('Mac focused field probe', () => {
  it('reads the focused field with an identity that stays the same between reads', () => {
    const field = { AXRole: 'AXTextArea', AXValue: 'hey sam see you soon', AXIdentifier: 'composer', AXPosition: [10, 20] };
    const first = parseMacField(runProbe('field', { app: 'Messages', field }));
    expect(first).toEqual({ field: '4242|AXTextArea|composer||10,20', text: 'hey sam see you soon' });
    expect(parseMacField(runProbe('field', { app: 'Messages', field: { ...field, AXValue: 'changed' } }))?.field).toBe(first?.field);
  });

  it('never reads a password field', () => {
    expect(runProbe('field', { app: 'Safari', field: { AXRole: 'AXTextField', AXSubrole: 'AXSecureTextField', AXValue: 'hunter2' } })).toBe('{}');
    expect(runProbe('field', { app: 'Safari', field: { AXRole: 'AXSecureTextField', AXValue: 'hunter2' } })).toBe('{}');
  });

  it('skips fields that are too long or have no text', () => {
    expect(parseMacField(runProbe('field', { app: 'Notes', field: { AXRole: 'AXTextArea', AXValue: 'a'.repeat(MAC_FIELD_LIMIT + 1) } }))).toBeUndefined();
    expect(parseMacField(runProbe('field', { app: 'Notes', field: { AXRole: 'AXButton' } }))).toBeUndefined();
  });

  it('ignores malformed output', () => {
    expect(parseMacField('not json')).toBeUndefined();
    expect(parseMacField('[]')).toBeUndefined();
    expect(parseMacContext('')).toBeUndefined();
    expect(parseMacContext('{"application": 5}')).toBeUndefined();
  });
});
