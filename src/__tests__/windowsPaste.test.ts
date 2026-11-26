import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  return { ...actual, spawn: mocks.spawn };
});

class FakeStream extends EventEmitter {
  resume = vi.fn();
}

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  stdout = new FakeStream();
  stderr = new FakeStream();
  written: string[] = [];
  stdin = Object.assign(new EventEmitter(), {
    write: vi.fn((chunk: string) => {
      this.written.push(chunk);
      return true;
    }),
  });
  kill = vi.fn(() => {
    this.exitCode = 1;
    this.emit('close', 1);
    return true;
  });
}

describe('pasteIntoWindowsField lifecycle', () => {
  let children: FakeChild[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    children = [];
    mocks.spawn.mockImplementation(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses a warmed helper, sends paste on stdout signal, and resolves true on exit 0', async () => {
    const mod = await import('../../electron/windowsPaste');
    mod.prepareWindowsPaste();
    expect(children).toHaveLength(1);

    const sendPaste = vi.fn();
    const pending = mod.pasteIntoWindowsField(sendPaste);
    expect(children).toHaveLength(1);
    expect(children[0].written).toEqual(['\n']);

    children[0].stdout.emit('data', 'paste\n');
    expect(sendPaste).toHaveBeenCalledTimes(1);
    expect(children[0].written).toEqual(['\n', '\n']);

    children[0].exitCode = 0;
    children[0].emit('close', 0);
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false without sending paste when the helper rejects the target', async () => {
    const mod = await import('../../electron/windowsPaste');
    const sendPaste = vi.fn();
    const pending = mod.pasteIntoWindowsField(sendPaste);

    children[0].exitCode = 1;
    children[0].emit('close', 1);
    await expect(pending).resolves.toBe(false);
    expect(sendPaste).not.toHaveBeenCalled();
  });

  it('kills a hung helper after 6 seconds and resolves false', async () => {
    vi.useFakeTimers();
    const mod = await import('../../electron/windowsPaste');
    const sendPaste = vi.fn();
    const pending = mod.pasteIntoWindowsField(sendPaste);

    vi.advanceTimersByTime(6000);
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toBe(false);
    expect(sendPaste).not.toHaveBeenCalled();
  });
});

interface PsElementSpec {
  controlType: 'Edit' | 'Document' | 'Button' | 'Pane' | 'Custom';
  isEnabled: boolean;
  isPassword: boolean;
  frameworkId?: string;
  valuePattern?: { isReadOnly: boolean; initial: string; afterPaste?: string; throwOnRead?: boolean };
  textPattern?: { isReadOnly: boolean; initial: string; afterPaste?: string; throwOnRead?: boolean };
}

function captureVerifyPasteScript(): Promise<string> {
  return (async () => {
    vi.resetModules();
    vi.clearAllMocks();
    let encoded = '';
    mocks.spawn.mockImplementation((_cmd: string, args: string[]) => {
      const idx = args.indexOf('-EncodedCommand');
      encoded = idx >= 0 ? args[idx + 1] : '';
      return new FakeChild();
    });
    const mod = await import('../../electron/windowsPaste');
    mod.prepareWindowsPaste();
    return Buffer.from(encoded, 'base64').toString('utf16le');
  })();
}

/**
 * Executes the real PowerShell verification script from windowsPaste.ts inside powershell.exe,
 * replacing only the UIA FocusedElement lookup and stdin/stdout paste handshake with an
 * in-process test harness so every branch of the real script runs against controlled UIA shapes.
 */
function runVerifyPasteCases(script: string, cases: Record<string, PsElementSpec>): Record<string, { exitCode: number; pasted: boolean; error: string }> {
  const harness = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$scriptBody = @'
${script}
'@
$casesJson = @'
${JSON.stringify(cases)}
'@
$cases = $casesJson | ConvertFrom-Json
$results = @{}

# Extract the real verification script body, substituting FocusedElement and the Console handshake.
$testable = $scriptBody
$testable = $testable -replace '\\$automation = \\[Windows\\.Automation\\.AutomationElement\\]', '$automation = $fakeAutomation'
$testable = $testable -replace 'if \\(\\$null -eq \\[Console\\]::ReadLine\\(\\)\\) \\{ exit 1 \\}', 'if ($script:stage -eq 0) { $script:stage = 1 } else { $script:stage = 2 }'
$testable = $testable -replace '\\[Console\\]::Out\\.WriteLine\\(''paste''\\)', '$script:pasted = $true; $script:valueState = $script:afterPaste'
$testable = $testable -replace '\\bexit\\s+(\\d+)', '$script:code = $1; return'

foreach ($prop in $cases.PSObject.Properties) {
  $name = $prop.Name
  $spec = $prop.Value
  $script:pasted = $false
  $script:code = 0
  $script:stage = 0
  $script:valueState = if ($spec.valuePattern) { $spec.valuePattern.initial } elseif ($spec.textPattern) { $spec.textPattern.initial } else { '' }
  $script:afterPaste = if ($spec.valuePattern -and $null -ne $spec.valuePattern.afterPaste) { $spec.valuePattern.afterPaste } elseif ($spec.textPattern -and $null -ne $spec.textPattern.afterPaste) { $spec.textPattern.afterPaste } else { $script:valueState }
  $errText = ''

  $ctrlType = [Windows.Automation.ControlType]::($spec.controlType)
  $el = New-Object PSObject
  $el | Add-Member NoteProperty Current ([PSCustomObject]@{
    IsEnabled = [bool]$spec.isEnabled
    IsPassword = [bool]$spec.isPassword
    ControlType = $ctrlType
    ProcessId = $PID
    FrameworkId = [string]$spec.frameworkId
  })
  $el | Add-Member NoteProperty _spec $spec
  $el | Add-Member ScriptMethod FindFirst { param($scope, $cond) return $null }
  $el | Add-Member ScriptMethod TryGetCurrentPattern {
    param($pattern, [ref]$out)
    if ($pattern -eq [Windows.Automation.ValuePattern]::Pattern -and $null -ne $this._spec.valuePattern) {
      $vp = New-Object PSObject
      $vpSpec = $this._spec.valuePattern
      $cur = New-Object PSObject
      $cur | Add-Member NoteProperty IsReadOnly ([bool]$vpSpec.isReadOnly)
      $cur | Add-Member ScriptProperty Value {
        if ($vpSpec.throwOnRead) { throw 'PASSWORD_VALUE_READ_VIOLATION' }
        return $script:valueState
      }
      $vp | Add-Member NoteProperty Current $cur
      $out.Value = $vp
      return $true
    }
    if ($pattern -eq [Windows.Automation.TextPattern]::Pattern -and $null -ne $this._spec.textPattern) {
      $tpSpec = $this._spec.textPattern
      $docRange = New-Object PSObject
      $docRange | Add-Member NoteProperty _ro ([bool]$tpSpec.isReadOnly)
      $docRange | Add-Member NoteProperty _throw ([bool]$tpSpec.throwOnRead)
      $docRange | Add-Member ScriptMethod GetAttributeValue { param($attr) return $this._ro }
      $docRange | Add-Member ScriptMethod GetText {
        param($max)
        if ($this._throw) { throw 'PASSWORD_TEXT_READ_VIOLATION' }
        return $script:valueState
      }
      $tp = [PSCustomObject]@{ DocumentRange = $docRange }
      $out.Value = $tp
      return $true
    }
    return $false
  }

  $fakeAutomation = [PSCustomObject]@{
    FocusedElement = $el
    IsKeyboardFocusableProperty = [Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty
  }

  # Use a minimal class wrapper so $automation::FocusedElement static syntax resolves to our test element.
  $codeBlock = $testable -replace '\\$automation::FocusedElement', '$fakeAutomation.FocusedElement'
  $codeBlock = $codeBlock -replace '\\$automation::IsKeyboardFocusableProperty', '[Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty'
  try {
    & ([ScriptBlock]::Create($codeBlock))
  } catch {
    $script:code = 99
    $errText = $_.Exception.Message
  }
  $results[$name] = @{ exitCode = $script:code; pasted = $script:pasted; error = $errText }
}

$results | ConvertTo-Json -Compress
`;

  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 15000, windowsHide: true },
  );
  return JSON.parse(out.trim());
}

describe.runIf(process.platform === 'win32')('windowsPaste real PowerShell target checks', () => {
  it('allows pasting into enabled non-read-only password fields without reading their value, while rejecting read-only, disabled, and non-text targets', async () => {
    const script = await captureVerifyPasteScript();
    const results = runVerifyPasteCases(script, {
      win32Password: {
        controlType: 'Edit',
        isEnabled: true,
        isPassword: true,
        valuePattern: { isReadOnly: false, initial: 'secret', throwOnRead: true },
      },
      chromePassword: {
        controlType: 'Edit',
        isEnabled: true,
        isPassword: true,
        frameworkId: 'Chrome',
        valuePattern: { isReadOnly: false, initial: '•••••••', throwOnRead: true },
      },
      readOnlyPassword: {
        controlType: 'Edit',
        isEnabled: true,
        isPassword: true,
        valuePattern: { isReadOnly: true, initial: 'secret', throwOnRead: true },
      },
      disabledPassword: {
        controlType: 'Edit',
        isEnabled: false,
        isPassword: true,
        valuePattern: { isReadOnly: false, initial: 'secret', throwOnRead: true },
      },
      textPatternReadOnlyPassword: {
        controlType: 'Edit',
        isEnabled: true,
        isPassword: true,
        textPattern: { isReadOnly: true, initial: 'secret', throwOnRead: true },
      },
      normalEditable: {
        controlType: 'Edit',
        isEnabled: true,
        isPassword: false,
        valuePattern: { isReadOnly: false, initial: 'hello', afterPaste: 'hello world' },
      },
      normalReadOnly: {
        controlType: 'Edit',
        isEnabled: true,
        isPassword: false,
        valuePattern: { isReadOnly: true, initial: 'fixed' },
      },
      buttonControl: {
        controlType: 'Button',
        isEnabled: true,
        isPassword: false,
      },
    });

    // Enabled writable password fields must accept paste WITHOUT reading the password value.
    expect(results.win32Password).toEqual({ exitCode: 0, pasted: true, error: '' });
    expect(results.chromePassword).toEqual({ exitCode: 0, pasted: true, error: '' });

    // Read-only or disabled password fields must still be rejected without reading the value.
    expect(results.readOnlyPassword).toEqual({ exitCode: 1, pasted: false, error: '' });
    expect(results.disabledPassword).toEqual({ exitCode: 1, pasted: false, error: '' });
    expect(results.textPatternReadOnlyPassword).toEqual({ exitCode: 1, pasted: false, error: '' });

    // Standard editable, read-only, and non-text controls keep existing behavior.
    expect(results.normalEditable).toEqual({ exitCode: 0, pasted: true, error: '' });
    expect(results.normalReadOnly).toEqual({ exitCode: 1, pasted: false, error: '' });
    expect(results.buttonControl).toEqual({ exitCode: 1, pasted: false, error: '' });
  });
});
