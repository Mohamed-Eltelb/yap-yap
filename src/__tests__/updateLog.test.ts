import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUpdateLogger } from '../../electron/updateLog';

describe('createUpdateLogger', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yy-updatelog-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('appends timestamped lines, creating the folder', () => {
    const file = path.join(dir, 'logs', 'updates.log');
    const log = createUpdateLogger(file);
    log.info('Checking for update');
    log.error(new Error('net::ERR_CONNECTION_RESET'));
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT.* INFO  Checking for update$/);
    expect(lines[1]).toContain('ERROR Error: net::ERR_CONNECTION_RESET');
  });

  it('moves a full log to .old and starts a new one', () => {
    const file = path.join(dir, 'updates.log');
    const log = createUpdateLogger(file, 100);
    log.info('x'.repeat(150));
    log.warn('after rotation');
    expect(fs.readFileSync(`${file}.old`, 'utf8')).toContain('x'.repeat(150));
    expect(fs.readFileSync(file, 'utf8')).toContain('WARN  after rotation');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('xxx');
  });

  it('never throws when the log cannot be written', () => {
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, '');
    const log = createUpdateLogger(path.join(blocker, 'updates.log'));
    expect(() => log.info('ignored')).not.toThrow();
  });
});
