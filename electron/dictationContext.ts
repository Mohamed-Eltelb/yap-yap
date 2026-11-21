import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { FocusedField } from './pasteCorrections';
import { macProbe, parseMacContext, parseMacField } from './macContext';

export interface DictationContext {
  application: string;
  domain?: string;
  /** Text in the focused field on either side of the caret. Never stored. */
  textBefore?: string;
  textAfter?: string;
}

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
# One request per input line: an id, then an optional command. Each answer repeats the id so
# answers are matched to their requests.
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id, $command = $line.Split(' ', 2)
  $json = $null
  try {
    if ($command -eq 'field') { $json = @(Get-FocusedField)[-1] } else { $json = @(Get-DictationContext)[-1] }
  } catch { }
  if (!$json) { $json = '{}' }
  [Console]::Out.WriteLine($id + ' ' + $json)
}
`;

// Starting PowerShell and loading UI Automation takes about a second, so one helper stays
// warm for the life of the app and answers each request in a few milliseconds.
let helper: ChildProcessWithoutNullStreams | undefined;
const waiting = new Map<number, (line: string) => void>();
let requestId = 0;

function windowsHelper(): ChildProcessWithoutNullStreams {
  if (helper) return helper;
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand',
    Buffer.from(windowsContext, 'utf16le').toString('base64'),
  ], { windowsHide: true });
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
      const [, id, json] = buffered.slice(0, end).match(/^(\d+) (.*)$/s) ?? [];
      buffered = buffered.slice(end + 1);
      waiting.get(Number(id))?.(json.trim());
    }
  });
  child.stderr.resume();
  const reset = () => {
    if (helper === child) helper = undefined;
    for (const done of [...waiting.values()]) done('');
  };
  child.on('exit', reset);
  child.on('error', reset);
  helper = child;
  return child;
}

function askWindowsHelper(command = ''): Promise<string> {
  return new Promise((resolve) => {
    const id = ++requestId;
    const done = (line: string) => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve(line);
    };
    // Context reading is skipped when it cannot finish quickly, so dictation is never held up.
    const timer = setTimeout(() => done(''), 1500);
    waiting.set(id, done);
    try {
      windowsHelper().stdin.write(`${id} ${command}\n`);
    } catch {
      done('');
    }
  });
}

export async function readFocusedField(): Promise<FocusedField | undefined> {
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
  helper?.kill();
  helper = undefined;
}

// Context reading is skipped when it cannot finish quickly, so dictation is never held up.
function runContextProbe(file: string, args: string[], maxBuffer = 8192): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 1500, windowsHide: true, maxBuffer }, (error, stdout) => {
      resolve(error ? '' : stdout.trim());
    });
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

  const application = await runContextProbe('xdotool', ['getactivewindow', 'getwindowpid']).then((pid) =>
    /^\d+$/.test(pid) ? runContextProbe('ps', ['-p', pid, '-o', 'comm=']) : '');
  if (application) return { application: application.slice(0, 100) };
}
