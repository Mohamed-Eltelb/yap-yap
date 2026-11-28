import { execFileSync, spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { linuxInputMethod } from '../../electron/linuxInputMethod';

// Exercise the probe's actual range and delivery checks without switching the CI desktop's keyboard.
it.skipIf(process.platform !== 'linux' || spawnSync('python3', ['--version']).status !== 0)(
  'reads Unicode selections, verifies commits and declines a possibly clipped selection', () => {
    const fixture = String.raw`
import io, json, sys
from types import SimpleNamespace

field = SimpleNamespace(updated=0)
commits = []
def with_ibus(operation, surrounding):
    assert surrounding
    return operation(field, lambda condition: condition())

field.snapshot = ('a🦊éz', 3, 1)
selection = input_method_field('selection')

def commit(text):
    commits.append(text)
    field.snapshot = ('a' + text + 'z', 2, 2)

field.commit_string = commit
sys.stdin = io.StringIO('x')
confirmed = input_method_field('insert')

field.snapshot = ('a🦊éz', 3, 1)
field.commit_string = commits.append
sys.stdin = io.StringIO('x')
unconfirmed = input_method_field('insert')

field.snapshot = ('a🦊éz', 3, 1)
field.commit_string = commit
def replace(selected):
    sys.stdin = io.StringIO(json.dumps({'text': 'x', 'selectedText': selected}))
    return input_method_field('replace')
changed = replace('old')
matched = replace('🦊é')

field.snapshot = ('é' * 2000, 0, 2000)
clipped = input_method_field('selection')
print(json.dumps([selection, confirmed, unconfirmed, changed, matched, clipped, commits]))
`;
    const output = execFileSync('python3', ['-c', linuxInputMethod + fixture], { encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual([
      { text: '🦊é', editable: true }, { inserted: true }, { inserted: false }, false, { inserted: true }, false, ['x', 'x', 'x'],
    ]);
  },
);
