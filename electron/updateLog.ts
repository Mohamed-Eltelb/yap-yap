import fs from 'node:fs';
import path from 'node:path';

export interface UpdateLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
}

function text(message: unknown): string {
  if (message instanceof Error) return message.stack ?? message.message;
  return typeof message === 'string' ? message : String(message);
}

/**
 * A plain-text log of update checks, downloads and installs, so a failed or repeated update can
 * be diagnosed afterwards. When the file passes `maxBytes` it moves to `<name>.old` and starts
 * again, so at most two files are kept. Writing never throws: a log must not break an update.
 */
export function createUpdateLogger(file: string, maxBytes = 512 * 1024): UpdateLogger {
  const write = (level: string, message: unknown) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.old`);
      } catch {
        // No log yet.
      }
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${text(message)}\n`);
    } catch {
      // Logging is best effort.
    }
  };
  return {
    info: message => write('INFO ', message),
    warn: message => write('WARN ', message),
    error: message => write('ERROR', message),
  };
}
