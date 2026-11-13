import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

// Decides whether the focused control can take a paste and, where the control
// exposes its text, confirms that the paste changed it.
const verifyPaste = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
# The helper is started early so this wait hides the PowerShell startup time.
if ($null -eq [Console]::ReadLine()) { exit 1 }

# Chromium and Electron apps only expose the real focused element shortly after
# the first UI Automation query, so a missing text pattern is retried.
$read = $null
for ($attempt = 0; $attempt -lt 6 -and !$read; $attempt++) {
  if ($attempt) { Start-Sleep -Milliseconds 80 }
  $element = [Windows.Automation.AutomationElement]::FocusedElement
  if (!$element -or !$element.Current.IsEnabled -or $element.Current.IsPassword) { exit 1 }
  $value = $null
  $text = $null
  if ($element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
    if ($value.Current.IsReadOnly) { exit 1 }
    $read = { $value.Current.Value }
  } elseif ($element.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$text)) {
    $readOnly = $text.DocumentRange.GetAttributeValue([Windows.Automation.TextPattern]::IsReadOnlyAttribute)
    if ($readOnly -is [bool] -and $readOnly) { exit 1 }
    $read = { $text.DocumentRange.GetText(-1) }
  } elseif ($element.Current.FrameworkId -ne 'Chrome') {
    break
  }
}

if (!$read) {
  # Many apps (terminals, code editors, some native text boxes) take a paste
  # without exposing their text, and show up here as a bare pane. Only controls
  # that are clearly not text inputs, such as buttons and lists, are skipped.
  $types = [Windows.Automation.ControlType]
  $inputLike = $types::Edit, $types::Document, $types::ComboBox, $types::Custom, $types::Group, $types::Pane, $types::Text
  $type = $element.Current.ControlType
  # Apps that draw their own UI (Zed, GPU terminals, games) expose nothing but
  # an empty window, so the text field inside it cannot be seen. Paste anyway.
  $children = [Windows.Automation.TreeScope]::Children
  $opaque = $type -eq $types::Window -and
    !$element.FindFirst($children, [Windows.Automation.Condition]::TrueCondition)
  if (!$opaque -and $inputLike -notcontains $type) { exit 1 }
}

$before = if ($read) { & $read } else { $null }
# Electron sends Ctrl+V once it reads this line, then answers on stdin.
[Console]::Out.WriteLine('paste')
if ($null -eq [Console]::ReadLine()) { exit 1 }
if (!$read) { exit 0 }
for ($attempt = 0; $attempt -lt 10; $attempt++) {
  Start-Sleep -Milliseconds 75
  if ((& $read) -cne $before) { exit 0 }
}
exit 1
`;

let warm: ChildProcessWithoutNullStreams | undefined;

function startHelper(): ChildProcessWithoutNullStreams {
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand',
    Buffer.from(verifyPaste, 'utf16le').toString('base64'),
  ], { windowsHide: true });
  const expire = setTimeout(() => child.kill(), 120_000);
  child.on('error', () => undefined);
  child.on('close', () => {
    clearTimeout(expire);
    if (warm === child) warm = undefined;
  });
  child.stdin.on('error', () => child.kill());
  child.stderr.resume();
  return child;
}

/** Starts the helper ahead of time so the paste itself is not delayed. */
export function prepareWindowsPaste(): void {
  warm?.kill();
  warm = startHelper();
}

export function pasteIntoWindowsField(sendPaste: () => void): Promise<boolean> {
  const child = warm ?? startHelper();
  warm = undefined;
  if (child.pid === undefined || child.exitCode !== null) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill(), 6000);
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
    child.stdout.once('data', () => {
      try {
        sendPaste();
        child.stdin.write('\n');
      } catch {
        child.kill();
      }
    });
    child.stdin.write('\n');
  });
}
