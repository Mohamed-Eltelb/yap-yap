import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

// Decides whether the focused control can take a paste and, where the control
// exposes its text, confirms that the paste changed it.
const verifyPaste = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$automation = [Windows.Automation.AutomationElement]
$types = [Windows.Automation.ControlType]
# Chromium and Electron apps answer the first UI Automation query with an empty
# placeholder and expose the real focused element about half a second later.
# Asking once now, while the dictation is still being transcribed, wakes them up.
try { $null = $automation::FocusedElement } catch {}
# The helper is started early so this wait hides the PowerShell startup time.
if ($null -eq [Console]::ReadLine()) { exit 1 }

# A Chromium placeholder is retried in case the early query came too late.
$read = $null
$isPassword = $false
for ($attempt = 0; $attempt -lt 12 -and !$read; $attempt++) {
  if ($attempt) { Start-Sleep -Milliseconds 80 }
  $element = $automation::FocusedElement
  if (!$element -or !$element.Current.IsEnabled) { exit 1 }
  if ($element.Current.IsPassword) {
    # Allow pasting into enabled, writable password fields without ever reading their value.
    $value = $null
    if ($element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$value) -and $value.Current.IsReadOnly) { exit 1 }
    $text = $null
    if ($element.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$text)) {
      $readOnly = $text.DocumentRange.GetAttributeValue([Windows.Automation.TextPattern]::IsReadOnlyAttribute)
      if ($readOnly -is [bool] -and $readOnly) { exit 1 }
    }
    $isPassword = $true
    break
  }
  $value = $null
  $text = $null
  if ($element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
    if ($value.Current.IsReadOnly) { exit 1 }
    $read = { $value.Current.Value }
  } elseif ($element.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$text)) {
    $readOnly = $text.DocumentRange.GetAttributeValue([Windows.Automation.TextPattern]::IsReadOnlyAttribute)
    if ($readOnly -is [bool] -and $readOnly) { exit 1 }
    $read = { $text.DocumentRange.GetText(-1) }
  } elseif ($element.Current.FrameworkId -ne 'Chrome' -or $element.Current.ControlType -ne $types::Pane) {
    break
  }
}

$type = $element.Current.ControlType
# Rows, tabs and buttons can carry a value without being a place to type.
$never = $types::ListItem, $types::TreeItem, $types::TabItem, $types::MenuItem, $types::Button,
  $types::CheckBox, $types::RadioButton, $types::Hyperlink, $types::Slider, $types::Image
if ($never -contains $type) { exit 1 }
# Windows drops simulated keys sent to an app that runs as administrator, and
# such an app cannot be opened from a normal one.
$handle = $null
try { $handle = [Diagnostics.Process]::GetProcessById($element.Current.ProcessId).Handle } catch {}
if (!$handle) { exit 1 }

$fields = $types::Edit, $types::Document, $types::ComboBox, $types::Text
$shells = $types::Window, $types::Pane, $types::Custom, $types::Group
# Browsers and Electron apps report a changed field anywhere from a tenth of a
# second to several seconds after the paste, and their code editors and terminals
# never report it, so they are judged by the kind of control alone.
$web = 'Chrome', 'Gecko' -contains $element.Current.FrameworkId
if ($web -and $read) {
  if ($fields + $shells + $types::Spinner -notcontains $type) { exit 1 }
  # A drop-down list is a combo box without text of its own.
  $isList = $type -eq $types::ComboBox -and
    !$element.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$text)
  if ($isList) { exit 1 }
  $read = $null
} elseif (!$read -and !$isPassword -and $shells -contains $type) {
  # Terminals, some native text boxes, apps that draw their own UI (Zed, games)
  # and Electron apps with accessibility switched off take a paste but show up
  # as a bare pane or window. It is treated as a text field unless something
  # inside it can take focus, which makes it a container instead.
  $focusable = New-Object Windows.Automation.PropertyCondition($automation::IsKeyboardFocusableProperty, $true)
  if ($element.FindFirst([Windows.Automation.TreeScope]::Descendants, $focusable)) { exit 1 }
} elseif (!$read -and !$isPassword -and $fields -notcontains $type) {
  exit 1
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
# A field that was empty and is still empty may be a hidden stand-in for the
# real editor, so it says nothing about whether the paste arrived.
if ([string]::IsNullOrWhiteSpace($before) -and $fields -contains $type) { exit 0 }
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
