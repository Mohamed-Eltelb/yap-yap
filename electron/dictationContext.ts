import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { FocusedField } from './pasteCorrections';
import { macProbe, parseMacContext, parseMacField } from './macContext';
import { linuxContextProbe, linuxPrimaryStampProbe } from './linuxContext';
import { SELECTION_LIMIT } from './selectionLimit';
import { readNativeSelection } from './nativeSelection';
import { canReplaceCopiedSelection, type CopiedSelection } from './selectionCopy';

export interface DictationContext {
  application: string;
  domain?: string;
  /** Text in the focused field on either side of the caret. Never stored. */
  textBefore?: string;
  textAfter?: string;
}

/** Text the user selected in another app. Never stored. */
export interface SelectedText {
  text: string;
  /** The selection was longer than SELECTION_LIMIT and was cut there. */
  truncated: boolean;
  /** The selection sits in a field the user can type in, so it could be replaced. */
  editable?: boolean;
  /** Windows foreground window at capture, used to verify a live rewrite. */
  windowId?: string;
  /** Windows control that had focus when the selection was captured. */
  focusedWindowId?: string;
  /** The native in-cell editor must still have focus before an Excel rewrite can paste. */
  excelCellEditor?: string;
  /** Windows foreground process name (without .exe). */
  process?: string;
  viaCopy?: boolean;
}

export { SELECTION_LIMIT };

const windowsContext = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace YapYap -Name Foreground -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
# The browser's address bar, searched in the toolbar only. A page input is never the address bar.
function Find-Address($window) {
  if (!$window) { return $null }
  $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue(@{ node = $window; depth = 0 })
  for ($visited = 0; $queue.Count -and $visited -lt 600; $visited++) {
    $entry = $queue.Dequeue()
    $node = $entry.node
    if ($node.Current.ControlType -in @([Windows.Automation.ControlType]::Document, [Windows.Automation.ControlType]::TabItem)) { continue }
    # Firefox shows its address bar as a combo box, Chromium browsers as an edit box.
    if ($node.Current.ControlType -in @([Windows.Automation.ControlType]::Edit, [Windows.Automation.ControlType]::ComboBox) -and
        ($node.Current.AutomationId -in @('addressEditBox', 'urlbar-input') -or
         $node.Current.Name -match '^(Address and search bar|Search or enter address|Address bar)$')) {
      $value = $null
      if ($node.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$value)) { return $value.Current.Value }
      return $null
    }
    if ($entry.depth -ge 10) { continue }
    for ($child = $walker.GetFirstChild($node); $child -and $queue.Count -lt 600; $child = $walker.GetNextSibling($child)) {
      $queue.Enqueue(@{ node = $child; depth = $entry.depth + 1 })
    }
  }
  return $null
}
function Get-DictationContext {
$element = [Windows.Automation.AutomationElement]::FocusedElement
if (!$element -or !$element.Current.IsEnabled -or $element.Current.IsPassword) { return }
$process = Get-Process -Id $element.Current.ProcessId
$application = $process.ProcessName
try {
  $product = $process.MainModule.FileVersionInfo.ProductName
  if ($product) { $application = $product }
} catch { }
$context = @{ application = $application }
$walker = [Windows.Automation.TreeWalker]::ControlViewWalker
$window = $element
# Climb to the top-level window. Browsers nest inner windows that do not contain the toolbar.
$root = [Windows.Automation.AutomationElement]::RootElement
while ($true) {
  $parent = $walker.GetParent($window)
  if (!$parent -or [Windows.Automation.Automation]::Compare($parent, $root)) { break }
  $window = $parent
}

if ($process.ProcessName -match '^(chrome|msedge|firefox|brave|vivaldi|opera|arc|comet|zen)$') {
  $address = Find-Address $window
  # Firefox can report focus on a window that is not inside its main window. The foreground
  # window, when it belongs to the same browser, holds the toolbar.
  if ($null -eq $address) {
    try {
      $foreground = [Windows.Automation.AutomationElement]::FromHandle([YapYap.Foreground]::GetForegroundWindow())
      if ($foreground -and (Get-Process -Id $foreground.Current.ProcessId).ProcessName -eq $process.ProcessName) {
        $address = Find-Address $foreground
      }
    } catch { }
  }
  if ($null -ne $address) { $context.address = $address }
}

if ($element.Current.Name -notmatch 'address.*bar|search or enter address' -and
    $element.Current.AutomationId -notin @('addressEditBox', 'urlbar-input')) {
  $pattern = $null
  if ($element.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    $selection = $pattern.GetSelection() | Select-Object -First 1
    # A caret in a read-only page (no text box focused) would send the page's own text.
    if ($selection -and $selection.GetAttributeValue([Windows.Automation.TextPattern]::IsReadOnlyAttribute) -eq $true) { $selection = $null }
    if ($selection -and $selection.CompareEndpoints([Windows.Automation.Text.TextPatternRangeEndpoint]::Start, $selection, [Windows.Automation.Text.TextPatternRangeEndpoint]::End) -eq 0) {
      $start = [Windows.Automation.Text.TextPatternRangeEndpoint]::Start
      $end = [Windows.Automation.Text.TextPatternRangeEndpoint]::End
      $character = [Windows.Automation.Text.TextUnit]::Character
      $before = $selection.Clone()
      [void]$before.MoveEndpointByUnit($start, $character, -240)
      $after = $selection.Clone()
      [void]$after.MoveEndpointByUnit($end, $character, 120)
      $textBefore = $before.GetText(240)
      $textAfter = $after.GetText(120)
      # Chromium editors expose their placeholder as content. Treat that as an empty field.
      $labels = @($element.Current.Name, $element.Current.HelpText) | Where-Object { $_ }
      if (($textBefore + $textAfter).Trim() -notin $labels) {
        $context.textBefore = $textBefore
        $context.textAfter = $textAfter
      }
    }
  }
}
$context | ConvertTo-Json -Compress
}
# Text of the focused field around the caret, used to notice corrections after a paste.
function Get-FocusedField {
  $element = [Windows.Automation.AutomationElement]::FocusedElement
  if (!$element -or $element.Current.IsPassword) { return }
  $pattern = $null
  if (!$element.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { return }
  if ($pattern.DocumentRange.GetAttributeValue([Windows.Automation.TextPattern]::IsReadOnlyAttribute) -eq $true) { return }
  $range = $pattern.DocumentRange
  $selection = $pattern.GetSelection() | Select-Object -First 1
  if ($selection) {
    $range = $selection.Clone()
    $character = [Windows.Automation.Text.TextUnit]::Character
    [void]$range.MoveEndpointByUnit([Windows.Automation.Text.TextPatternRangeEndpoint]::Start, $character, -3000)
    [void]$range.MoveEndpointByUnit([Windows.Automation.Text.TextPatternRangeEndpoint]::End, $character, 3000)
  }
  @{ field = ($element.GetRuntimeId() -join '.'); text = $range.GetText(6000) } | ConvertTo-Json -Compress
}
# The text the user selected, read through accessibility so the clipboard is never touched.
# Read-only text counts too: a selection on a web page or in a PDF is often what is asked about.
function Get-Selection {
  $limit = ${SELECTION_LIMIT}
  $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
  $root = [Windows.Automation.AutomationElement]::RootElement
  # Browsers and Electron apps switch their accessibility on at the first query: until then they
  # show an empty placeholder pane, or a page whose selection reads as empty. So a browser that
  # shows no selection is asked again for about half a second. It runs while the user speaks.
  for ($attempt = 0; $attempt -lt 7; $attempt++) {
    if ($attempt) { Start-Sleep -Milliseconds 80 }
    $element = [Windows.Automation.AutomationElement]::FocusedElement
    if (!$element -or $element.Current.IsPassword) { return }
    $web = $element.Current.FrameworkId -in @('Chrome', 'Gecko')
    # A selection on a page belongs to the document, which may be an ancestor of what has focus.
    $pattern = $null
    $node = $element
    for ($depth = 0; $node -and $depth -lt 12; $depth++) {
      if ($node.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { break }
      $pattern = $null
      $node = $walker.GetParent($node)
      if ($node -and [Windows.Automation.Automation]::Compare($node, $root)) { break }
    }
    $parts = @()
    $length = 0
    $editable = $true
    if ($pattern) {
      foreach ($range in @($pattern.GetSelection())) {
        if (!$range -or $length -gt $limit) { continue }
        $piece = $range.GetText($limit + 1 - $length)
        if (!$piece) { continue }
        $parts += $piece
        $length += $piece.Length
        $ro = $range.GetAttributeValue([Windows.Automation.TextPattern]::IsReadOnlyAttribute)
        if ($ro -is [bool]) { if ($ro) { $editable = $false } }
        elseif ($element.Current.ControlType -ne [Windows.Automation.ControlType]::Edit) { $editable = $false }
      }
    }
    if ($parts.Count -or !$web) { break }
  }
  # No selection that accessibility can see: name the app, so the copy fallback can decide.
  if (!$parts.Count) {
    try { return @{ process = (Get-Process -Id $element.Current.ProcessId).ProcessName } | ConvertTo-Json -Compress } catch { return }
  }
  @{ text = ($parts -join [Environment]::NewLine); editable = $editable } | ConvertTo-Json -Compress
}
# One request per input line: an id, then an optional command. Each answer repeats the id so
# answers are matched to their requests.
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id, $command = $line.Split(' ', 2)
  $json = $null
  try {
    if ($command -eq 'field') { $json = @(Get-FocusedField)[-1] }
    elseif ($command -eq 'selection') { $json = @(Get-Selection)[-1] }
    else { $json = @(Get-DictationContext)[-1] }
  } catch { }
  if (!$json) { $json = '{}' }
  [Console]::Out.WriteLine($id + ' ' + $json)
}
`;

// Starting PowerShell and loading UI Automation takes about a second, so one helper stays
// warm for the life of the app and answers each request in a few milliseconds.
let helper: ChildProcessWithoutNullStreams | undefined;
let helperStartedAt = 0;
let helperTimeouts = 0;
const waiting = new Map<number, (line: string) => void>();
let requestId = 0;

function recycleWindowsHelper(child: ChildProcessWithoutNullStreams): void {
  if (helper !== child) return;
  helper = undefined;
  helperStartedAt = 0;
  helperTimeouts = 0;
  try { child.kill(); } catch { /* already exited */ }
}

function windowsHelper(): ChildProcessWithoutNullStreams {
  if (helper) return helper;
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand',
    Buffer.from(windowsContext, 'utf16le').toString('base64'),
  ], { windowsHide: true });
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    helperTimeouts = 0;
    buffered += chunk;
    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
      const [, id, json] = buffered.slice(0, end).match(/^(\d+) (.*)$/s) ?? [];
      buffered = buffered.slice(end + 1);
      waiting.get(Number(id))?.(json.trim());
    }
  });
  child.stderr.resume();
  const reset = () => {
    if (helper === child) {
      helper = undefined;
      helperStartedAt = 0;
      helperTimeouts = 0;
    }
    for (const done of [...waiting.values()]) done('');
  };
  child.on('exit', reset);
  child.on('error', reset);
  helper = child;
  helperStartedAt = Date.now();
  helperTimeouts = 0;
  return child;
}

function askWindowsHelper(command = '', timeoutMs = 1500): Promise<string> {
  return new Promise((resolve) => {
    const id = ++requestId;
    const child = windowsHelper();
    const done = (line: string) => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve(line);
    };
    // Context reading is skipped when it cannot finish quickly, so dictation is never held up.
    // If a warm helper hangs on a wedged UIA provider, recycle it so later calls recover.
    const timer = setTimeout(() => {
      helperTimeouts += 1;
      if (Date.now() - helperStartedAt > 4000 || helperTimeouts >= 2) {
        recycleWindowsHelper(child);
      }
      done('');
    }, timeoutMs);
    waiting.set(id, done);
    try {
      child.stdin.write(`${id} ${command}\n`);
    } catch {
      recycleWindowsHelper(child);
      done('');
    }
  });
}

export const isWayland = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY));

async function linuxForegroundPid(): Promise<string | undefined> {
  if (isWayland) {
    const { pid } = await linuxProbe('0', 'pid');
    return typeof pid === 'number' && pid > 0 && pid !== process.pid ? String(pid) : undefined;
  }
  const pid = await runContextProbe('xdotool', ['getactivewindow', 'getwindowpid']);
  return /^\d+$/.test(pid) ? pid : undefined;
}

const linuxProcessName = (pid: string) => runContextProbe('ps', ['-p', pid, '-o', 'comm=']);

// The probe treats a focused field as an address bar only in a browser. Other apps can
// put ordinary text fields, such as a find bar, in a toolbar.
async function linuxProbe(pid: string, mode: 'context' | 'field' | 'paste' | 'selection' | 'pid' | 'insert', browser = false, input?: string): Promise<Record<string, unknown>> {
  const args = ['-c', linuxContextProbe, pid, mode, browser ? 'browser' : 'app'];
  const useInputMethod = isWayland && (mode === 'selection' || mode === 'insert');
  if (pid === '0') args.push(String(process.pid));
  if (useInputMethod) args.push('wayland');
  const output = await runContextProbe('/usr/bin/python3', args, 1 << 18, useInputMethod ? 5500 : 1500, input);
  try {
    return JSON.parse(output);
  } catch {
    return {};
  }
}

export async function linuxPrimaryStamp(): Promise<number | undefined> {
  if (!process.env.DISPLAY || isWayland) return;
  const stamp = await runContextProbe('/usr/bin/python3', ['-c', linuxPrimaryStampProbe], 8192, 500);
  return stamp ? Number(stamp) : undefined;
}

// Selection and paste can each briefly switch input methods. Overlapping requests
// are declined so a queued operation never reaches a different editor.
let usingWaylandField = false;
async function waylandField(mode: 'selection' | 'insert', text?: string): Promise<Record<string, unknown>> {
  if (usingWaylandField) return {};
  usingWaylandField = true;
  try {
    return await linuxProbe('0', mode, false, text);
  } finally {
    usingWaylandField = false;
  }
}

export async function insertWaylandText(text: string): Promise<boolean> {
  return (await waylandField('insert', text)).inserted === true;
}

const linuxBrowser = /^(chromium|chromium-browse|chrome|google-chrome|firefox|firefox-bin|firefox-esr|brave|msedge|vivaldi|opera)$/i;

// Paste is still sent when it can't be confirmed, but the result card stays available
// because a keypress alone does not prove the text arrived. That covers browsers that
// expose no accessibility tree, and Wayland windows, which X11 tools cannot see.
export async function linuxPasteTarget(): Promise<'field' | 'blocked' | 'unconfirmed' | undefined> {
  const pid = await linuxForegroundPid();
  if (!pid) return 'unconfirmed';
  const [probe, processName] = await Promise.all([
    linuxProbe(pid, 'paste'),
    linuxProcessName(pid),
  ]);
  if (probe.editable === true) return 'field';
  if (probe.editable === false) return 'blocked';
  if (linuxBrowser.test(processName)) return 'unconfirmed';
}

export async function readFocusedField(): Promise<FocusedField | undefined> {
  if (process.platform === 'linux') {
    const pid = await linuxForegroundPid();
    if (!pid) return;
    const { field, text } = await linuxProbe(pid, 'field', linuxBrowser.test(await linuxProcessName(pid)));
    if (typeof field === 'string' && typeof text === 'string') return { field, text };
    return;
  }
  if (process.platform === 'darwin') return parseMacField(await runContextProbe('osascript', ['-l', 'JavaScript', '-e', macProbe('field')], 1 << 20));
  if (process.platform !== 'win32') return;
  try {
    const data = JSON.parse(await askWindowsHelper('field'));
    if (typeof data.field === 'string' && typeof data.text === 'string') return { field: data.field, text: data.text };
  } catch {
    // An unreadable field simply teaches nothing.
  }
}

export function warmDictationContext(): void {
  if (process.platform === 'win32') windowsHelper();
}

export function stopDictationContext(): void {
  if (helper) recycleWindowsHelper(helper);
}

// Context reading is skipped when it cannot finish quickly, so dictation is never held up.
function runContextProbe(file: string, args: string[], maxBuffer = 8192, timeout = 1500, input?: string): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(file, args, { timeout, windowsHide: true, maxBuffer }, (error, stdout) => {
      resolve(error ? '' : stdout.trim());
    });
    if (input !== undefined) {
      // The target may have closed before the probe read its input.
      child.stdin?.on('error', () => resolve(''));
      child.stdin?.end(input);
    }
  });
}

/** Marks a button, image, or other element embedded in a stretch of text. */
const EMBEDDED_OBJECT = String.fromCharCode(0xfffc);

/**
 * Text beside the caret, up to the nearest embedded element. Web apps like Google Sheets make the
 * whole page one editable area, so past that mark lie toolbars and tabs, not the user's writing.
 */
export function nearbyText(text: string, side: 'before' | 'after'): string | undefined {
  if (side === 'before') {
    const start = text.lastIndexOf(EMBEDDED_OBJECT);
    return text.slice(start + 1).slice(-240) || undefined;
  }
  const end = text.indexOf(EMBEDDED_OBJECT);
  return (end < 0 ? text : text.slice(0, end)).slice(0, 120) || undefined;
}

export function browserDomain(address: unknown): string | undefined {
  if (typeof address !== 'string' || /\s/.test(address) || address.length > 4096) return;
  try {
    const url = new URL(address.includes('://') ? address : `https://${address}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    if (!/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(url.hostname)) return;
    // Google keeps Sheets, Slides, and Forms on docs.google.com; only the first path part tells
    // them apart. They are named by their own hosts, and nothing else of the path is kept.
    if (url.hostname.toLowerCase() === 'docs.google.com') {
      const kind = url.pathname.split('/')[1]?.toLowerCase();
      const host = { spreadsheets: 'sheets.google.com', presentation: 'slides.google.com', forms: 'forms.google.com' }[kind ?? ''];
      if (host) return host;
    }
    return url.hostname;
  } catch {
    return undefined;
  }
}

export async function captureDictationContext(): Promise<DictationContext | undefined> {
  if (process.platform === 'win32') {
    const result = await askWindowsHelper();
    if (!result) return;
    try {
      const data = JSON.parse(result);
      if (typeof data.application !== 'string') return;
      return {
        application: data.application.trim().slice(0, 100),
        domain: browserDomain(data.address),
        // Not trimmed: whitespace at the caret decides spacing.
        textBefore: typeof data.textBefore === 'string' ? nearbyText(data.textBefore, 'before') : undefined,
        textAfter: typeof data.textAfter === 'string' ? nearbyText(data.textAfter, 'after') : undefined,
      };
    } catch {
      return undefined;
    }
  }

  if (process.platform === 'darwin') {
    const mac = parseMacContext(await runContextProbe('osascript', ['-l', 'JavaScript', '-e', macProbe('context')]));
    if (!mac) return;
    const domain = browserDomain(mac.address);
    return domain ? { application: mac.application, domain } : { application: mac.application };
  }

  if (process.platform !== 'linux') return;
  const pid = await linuxForegroundPid();
  if (!pid) return;
  const application = await linuxProcessName(pid);
  if (!application) return;
  const browser = linuxBrowser.test(application);
  const field = await linuxProbe(pid, 'context', browser);
  return {
    application: application.slice(0, 100),
    // Only a browser's page address names a site. Other apps can embed web views of their own.
    domain: browser ? browserDomain(field.url) : undefined,
    textBefore: typeof field.textBefore === 'string' ? field.textBefore : undefined,
    textAfter: typeof field.textAfter === 'string' ? field.textAfter : undefined,
  };
}

/** A selection from any probe's JSON. Whitespace alone is no selection; the text is otherwise kept exactly. */
export function parseSelection(data: unknown): SelectedText | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { text, editable } = data as Record<string, unknown>;
  if (typeof text !== 'string' || !text.trim()) return undefined;
  // An emoji is two UTF-16 units: a cut between them would leave half of one.
  const cut = /[\uD800-\uDBFF]/.test(text.charAt(SELECTION_LIMIT - 1)) ? SELECTION_LIMIT - 1 : SELECTION_LIMIT;
  return {
    text: text.slice(0, cut),
    truncated: text.length > SELECTION_LIMIT,
    ...(typeof editable === 'boolean' ? { editable } : {}),
  };
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

/**
 * The text selected in the app in front, read through accessibility (UI Automation, AX, AT-SPI).
 * On Windows, an app that does not share its selection that way can be copied from instead: `copy`
 * gets the app's process name and decides. Used by Ask anything, and meant for transforms as well.
 * It runs while the user is speaking, so it may take longer than the caret context.
 * A Windows rewrite uses the native read to check which targets can be rewritten through Copy.
 */
export async function captureSelection(
  copy?: (
    processName: string,
    options?: { allowCtrlCFallback?: boolean; inTerminal?: boolean },
  ) => Promise<string | CopiedSelection | undefined>,
  forRewrite = false,
  excelInCellEdit = false,
): Promise<SelectedText | undefined> {
  if (process.platform === 'win32') {
    // yapyap-text.dll reads it inside Yap Yap; the PowerShell helper stands in when it can't load.
    const native = await readNativeSelection(forRewrite ? 1200 : 4000, forRewrite);
    if (forRewrite && !native) return;
    if (native?.password) return undefined;
    const data = native
      ? (native.text ? { text: native.text, editable: native.editable } : { process: native.process })
      : parseJson(await askWindowsHelper('selection', 3000));
    const found = parseSelection(data);
    const processName = native?.process || (data as { process?: unknown } | undefined)?.process;
    if (found) {
      return typeof processName === 'string' && processName ? { ...found, process: processName } : found;
    }
    if (!copy || typeof processName !== 'string') return undefined;
    const inTerminal = native?.inTerminal === true;
    const editable = native
      ? canReplaceCopiedSelection(processName, native.writableField, excelInCellEdit, inTerminal)
      : undefined;
    if (forRewrite && !editable) return;
    const allowCtrlCFallback = !!native && !inTerminal && !native.uiaOpaque;
    const result = await copy(processName, { allowCtrlCFallback, inTerminal });
    const copied = typeof result === 'object'
      ? parseSelection({ text: result.text, editable: result.readOnly ? false : editable })
      : parseSelection({ text: result, editable });
    return copied && {
      ...copied,
      viaCopy: true,
      ...(processName ? { process: processName } : {}),
    };
  }
  if (process.platform === 'darwin') {
    return parseSelection(parseJson(await runContextProbe('osascript', ['-l', 'JavaScript', '-e', macProbe('selection')], 1 << 20, 3000)));
  }
  if (process.platform !== 'linux') return;
  if (isWayland) return parseSelection(await waylandField('selection'));
  const pid = await linuxForegroundPid() ?? '0';
  const data = await linuxProbe(pid, 'selection');
  const found = parseSelection(data);
  if (found || !copy || (data as { password?: unknown } | undefined)?.password === true) return found;
  // Apps that share nothing (Chromium and Electron apps without accessibility on): the last
  // highlighted text. Where it came from is unknown, so it is never typed over.
  const copied = await copy('');
  return parseSelection({ text: typeof copied === 'object' ? copied.text : copied });
}
