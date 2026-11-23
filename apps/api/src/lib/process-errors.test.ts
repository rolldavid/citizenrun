import { EventEmitter } from 'node:events';
import { createLogger } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installProcessErrorHandlers,
  processErrorHandler,
  serverErrorHandler,
} from './process-errors.ts';

function capture(): { raw: string[]; logger: ReturnType<typeof createLogger> } {
  const raw: string[] = [];
  return {
    raw,
    logger: createLogger({
      service: 'api',
      level: 'debug',
      sink: (line) => {
        raw.push(line);
      },
    }),
  };
}

function parsed(raw: readonly string[]): Record<string, unknown>[] {
  return raw.map((line) => JSON.parse(line) as Record<string, unknown>); // the logger writes JSON objects
}

class FixtureCrashError extends Error {
  override readonly name = 'FixtureCrashError';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('processErrorHandler', () => {
  it('logs the class only and exits 1', () => {
    const secret = marker();
    for (const [source, error, errorClass] of [
      ['exception', new FixtureCrashError(`failed for ${secret}`), 'FixtureCrashError'],
      ['rejection', `rejected with ${secret}`, 'Error'],
      ['rejection', { name: 'NotAnError', message: secret }, 'Error'],
      ['exception', Object.assign(new Error(secret), { name: `bad name ${secret}` }), 'Error'],
    ] as const) {
      const { raw, logger } = capture();
      const exit = vi.fn<(code: number) => void>();
      processErrorHandler(logger, 'api.crashed', source, exit)(error);
      const lines = parsed(raw);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        time: expect.any(String) as unknown,
        level: 'error',
        service: 'api',
        event: 'api.crashed',
        errorClass,
        source,
      });
      expect(raw.join('\n')).not.toContain(secret);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    }
  });

  it('exits 1 even when the line cannot be written', () => {
    const exit = vi.fn<(code: number) => void>();
    const logger = createLogger({
      service: 'api',
      level: 'debug',
      sink: () => {
        throw new Error('fixture sink failure');
      },
    });
    expect(() => {
      processErrorHandler(logger, 'api.crashed', 'exception', exit)(new Error('x'));
    }).toThrow('fixture sink failure');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('installProcessErrorHandlers', () => {
  it('handles an uncaught exception and an unhandled rejection through the logger', () => {
    const before = {
      exception: process.listeners('uncaughtException'),
      rejection: process.listeners('unhandledRejection'),
    };
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { raw, logger } = capture();
    installProcessErrorHandlers(logger, 'api.crashed');
    const added = {
      exception: process
        .listeners('uncaughtException')
        .filter((l) => !before.exception.includes(l)),
      rejection: process
        .listeners('unhandledRejection')
        .filter((l) => !before.rejection.includes(l)),
    };
    try {
      expect(added.exception).toHaveLength(1);
      expect(added.rejection).toHaveLength(1);
      const secret = marker();
      added.exception[0]?.(new FixtureCrashError(secret), 'uncaughtException');
      added.rejection[0]?.(secret, Promise.resolve());
      expect(parsed(raw).map((line) => [line.event, line.errorClass, line.source])).toEqual([
        ['api.crashed', 'FixtureCrashError', 'exception'],
        ['api.crashed', 'Error', 'rejection'],
      ]);
      expect(raw.join('\n')).not.toContain(secret);
      expect(exit.mock.calls).toEqual([[1], [1]]);
    } finally {
      for (const listener of added.exception) {
        process.off('uncaughtException', listener);
      }
      for (const listener of added.rejection) {
        process.off('unhandledRejection', listener);
      }
    }
  });
});

describe('serverErrorHandler', () => {
  it('a failed bind logs start_failed and exits 1', () => {
    const secret = marker();
    const { raw, logger } = capture();
    const exit = vi.fn<(code: number) => void>();
    const server = new EventEmitter();
    server.on('error', serverErrorHandler(logger, exit));
    const error = Object.assign(new Error(`listen EADDRINUSE: address in use ${secret}`), {
      code: 'EADDRINUSE',
    });
    server.emit('error', error);
    const lines = parsed(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      time: expect.any(String) as unknown,
      level: 'error',
      service: 'api',
      event: 'api.start_failed',
      errorClass: 'Error',
    });
    expect(raw.join('\n')).not.toContain(secret);
    expect(raw.join('\n')).not.toContain('api.started');
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
