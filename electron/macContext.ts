// Mac context capture through JavaScript for Automation (osascript -l JavaScript).
// Reading the frontmost app and the focused field needs the Accessibility permission that
// pasting already uses. Reading a browser's address sends that browser an Apple event, so macOS
// asks once per browser. Every read fails quietly, leaving just the app name.
import type { FocusedField } from './pasteCorrections';

/** Browsers whose address the probe reads, by process name. Firefox offers no scripting for it. */
export const MAC_WEBKIT_BROWSERS = ['Safari', 'Safari Technology Preview', 'Orion'];
export const MAC_CHROMIUM_BROWSERS = [
  'Google Chrome', 'Google Chrome Beta', 'Google Chrome Canary', 'Chromium', 'Microsoft Edge',
  'Brave Browser', 'Vivaldi', 'Opera', 'Arc',
];

/** Field text past this length is not read: the paste could sit anywhere in it. */
export const MAC_FIELD_LIMIT = 12_000;

/**
 * The script for one read. "context" returns the frontmost app and, for a known browser that is
 * frontmost (so nothing is launched), its address. "field" returns the focused field's text.
 * Password fields are never read. Sizes are capped in the script so the output stays small.
 */
export function macProbe(command: 'context' | 'field'): string {
  return `
function run() {
  var command = ${JSON.stringify(command)};
  var webkit = ${JSON.stringify(MAC_WEBKIT_BROWSERS)};
  var chromium = ${JSON.stringify(MAC_CHROMIUM_BROWSERS)};
  var out = {};
  var process;
  try {
    process = Application('System Events').processes.whose({ frontmost: true })[0];
    out.application = process.name();
  } catch (error) {
    return '{}';
  }
  if (command === 'context') {
    try {
      if (webkit.indexOf(out.application) >= 0) out.address = Application(out.application).windows[0].currentTab.url();
      else if (chromium.indexOf(out.application) >= 0) out.address = Application(out.application).windows[0].activeTab.url();
    } catch (error) {}
    if (typeof out.address === 'string') out.address = out.address.slice(0, 2048);
    else delete out.address;
    return JSON.stringify(out);
  }
  try {
    var element = process.attributes.byName('AXFocusedUIElement').value();
    var read = function (name) {
      try { return element.attributes.byName(name).value(); } catch (error) { return undefined; }
    };
    var role = read('AXRole');
    if (role === 'AXSecureTextField' || read('AXSubrole') === 'AXSecureTextField') return '{}';
    var text = read('AXValue');
    if (typeof text !== 'string' || text.length > ${MAC_FIELD_LIMIT}) return '{}';
    var position = read('AXPosition');
    var id = [process.unixId(), role, read('AXIdentifier') || '', read('AXDescription') || '', position ? String(position) : ''];
    return JSON.stringify({ field: id.join('|'), text: text });
  } catch (error) {
    return '{}';
  }
}`;
}

function parse(output: string): Record<string, unknown> | undefined {
  try {
    const data: unknown = JSON.parse(output);
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** The app, and a browser's address, from a "context" read. Text near the caret is not read on Mac yet. */
export function parseMacContext(output: string): { application: string; address?: string } | undefined {
  const data = parse(output);
  const application = typeof data?.application === 'string' ? data.application.trim().slice(0, 100) : '';
  if (!application) return undefined;
  return typeof data?.address === 'string' ? { application, address: data.address } : { application };
}

/** The focused field from a "field" read. */
export function parseMacField(output: string): FocusedField | undefined {
  const data = parse(output);
  if (typeof data?.field !== 'string' || !data.field || typeof data.text !== 'string') return undefined;
  if (data.text.length > MAC_FIELD_LIMIT) return undefined;
  return { field: data.field, text: data.text };
}
