import { createLogger } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installProcessErrorHandlers, processErrorHandler } from './process-errors.ts';

function capture(): { raw: string[]; logger: ReturnType<typeof createLogger> } {
  const raw: string[] = [];
  return {
    raw,
    logger: createLogger({
      service: 'worker',
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
      processErrorHandler(logger, 'worker.crashed', source, exit)(error);
      const lines = parsed(raw);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        time: expect.any(String) as unknown,
        level: 'error',
        service: 'worker',
        event: 'worker.crashed',
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
      service: 'worker',
      level: 'debug',
      sink: () => {
        throw new Error('fixture sink failure');
      },
    });
    expect(() => {
      processErrorHandler(logger, 'worker.crashed', 'exception', exit)(new Error('x'));
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
    installProcessErrorHandlers(logger, 'worker.crashed');
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
        ['worker.crashed', 'FixtureCrashError', 'exception'],
        ['worker.crashed', 'Error', 'rejection'],
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
