import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { FocusedField } from './pasteCorrections';
import { macProbe, parseMacContext, parseMacField } from './macContext';
import { linuxContextProbe } from './linuxContext';

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
[Console]::OutputEncoding = [Text.Encoding]::UTF8
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

if ($process.ProcessName -match '^(chrome|msedge|firefox|brave|vivaldi|opera|arc|comet|zen)$' -and $window) {
  # Search browser chrome only. Never treat a page input as the address bar.
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue(@{ node = $window; depth = 0 })
  for ($visited = 0; $queue.Count -and $visited -lt 600; $visited++) {
    $entry = $queue.Dequeue()
    $node = $entry.node
    if ($node.Current.ControlType -in @([Windows.Automation.ControlType]::Document, [Windows.Automation.ControlType]::TabItem)) { continue }
    if ($node.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -and
        ($node.Current.AutomationId -in @('addressEditBox', 'urlbar-input') -or
         $node.Current.Name -match '^(Address and search bar|Search or enter address|Address bar)$')) {
      $address = $null
      if ($node.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$address)) {
        $context.address = $address.Current.Value
      }
      break
    }
    if ($entry.depth -ge 10) { continue }
    for ($child = $walker.GetFirstChild($node); $child -and $queue.Count -lt 600; $child = $walker.GetNextSibling($child)) {
      $queue.Enqueue(@{ node = $child; depth = $entry.depth + 1 })
    }
  }
}

if ($element.Current.Name -notmatch 'address.*bar|search or enter address' -and
    $element.Current.AutomationId -notin @('addressEditBox', 'urlbar-input')) {
  $pattern = $null
  if ($element.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    $selection = $pattern.GetSelection() | Select-Object -First 1
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

async function linuxForegroundPid(): Promise<string | undefined> {
  const pid = await runContextProbe('xdotool', ['getactivewindow', 'getwindowpid']);
  return /^\d+$/.test(pid) ? pid : undefined;
}

async function linuxProbe(pid: string, mode: 'context' | 'field' | 'paste'): Promise<Record<string, unknown>> {
  const output = await runContextProbe('/usr/bin/python3', ['-c', linuxContextProbe, pid, mode], 65536);
  try {
    return JSON.parse(output);
  } catch {
    return {};
  }
}

const linuxBrowser = /^(chromium|chromium-browse|chrome|google-chrome|firefox|firefox-esr|brave|msedge|vivaldi|opera)$/i;

// Some browsers expose no accessibility tree. Still send paste there, but leave
// the result card available because a keypress alone cannot confirm insertion.
export async function linuxPasteTarget(): Promise<'field' | 'page' | 'unconfirmed-browser' | undefined> {
  const pid = await linuxForegroundPid();
  if (!pid) return;
  const [probe, processName] = await Promise.all([
    linuxProbe(pid, 'paste'),
    runContextProbe('ps', ['-p', pid, '-o', 'comm=']),
  ]);
  if (probe.editable === true) return 'field';
  if (probe.editable === false) return 'page';
  if (linuxBrowser.test(processName)) return 'unconfirmed-browser';
}

export async function readFocusedField(): Promise<FocusedField | undefined> {
  if (process.platform === 'linux') {
    const pid = await linuxForegroundPid();
    if (!pid) return;
    const { field, text } = await linuxProbe(pid, 'field');
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
        textBefore: typeof data.textBefore === 'string' ? data.textBefore.slice(-240) || undefined : undefined,
        textAfter: typeof data.textAfter === 'string' ? data.textAfter.slice(0, 120) || undefined : undefined,
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
  const [application, field] = await Promise.all([
    runContextProbe('ps', ['-p', pid, '-o', 'comm=']),
    linuxProbe(pid, 'context'),
  ]);
  if (!application) return;
  return {
    application: application.slice(0, 100),
    // Only a browser's page address names a site. Other apps can embed web views of their own.
    domain: linuxBrowser.test(application) ? browserDomain(field.url) : undefined,
    textBefore: typeof field.textBefore === 'string' ? field.textBefore : undefined,
    textAfter: typeof field.textAfter === 'string' ? field.textAfter : undefined,
  };
}
