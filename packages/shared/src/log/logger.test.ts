import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';

const NOW = new Date('2027-03-05T22:00:00.000Z');

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  const lines: string[] = [];
  const log = createLogger({
    service: 'api',
    level,
    sink: (line) => {
      lines.push(line);
    },
    now: () => NOW,
  });
  return { log, lines };
}

describe('createLogger', () => {
  it('writes the line shape', () => {
    const { log, lines } = capture();
    log.info('request.done', { status: 200 });
    expect(lines).toHaveLength(1);
    const parsed: Record<string, unknown> = JSON.parse(lines[0] ?? '');
    expect(parsed).toEqual({
      time: '2027-03-05T22:00:00.000Z',
      level: 'info',
      service: 'api',
      event: 'request.done',
      status: 200,
    });
    expect(Object.keys(parsed).slice(0, 4)).toEqual(['time', 'level', 'service', 'event']);
  });

  it('drops lines below the level', () => {
    const { log, lines } = capture('warn');
    log.debug('a');
    log.info('b');
    expect(lines).toHaveLength(0);
    log.error('c');
    log.warn('d');
    const events = lines.map((line) => {
      const parsed: Record<string, unknown> = JSON.parse(line);
      return parsed.event;
    });
    expect(events).toEqual(['c', 'd']);
  });

  it('redacts bound and call fields', () => {
    const { log, lines } = capture();
    log.child({ email: 'a@b.example.test', requestId: 'r1' }).info('x', { token: 't-value' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('a@b.example.test');
    expect(lines[0]).not.toContain('t-value');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ requestId: 'r1' });
  });

  it('masks shaped values in allowed fields', () => {
    const { log, lines } = capture();
    log.warn('x', { info: 'from a@b.example.test' });
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ info: 'from [email]' });
  });

  it('a log call survives a getter that throws', () => {
    const { log, lines } = capture();
    const fields = {
      status: 500,
      get broken(): string {
        throw new Error('fixture getter failure');
      },
    };
    log.error('request.error', fields);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[unreadable]');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ status: 500, broken: '[unreadable]' });
  });

  it('cannot overwrite the required keys', () => {
    const { log, lines } = capture();
    log.child({ service: 'worker' }).info('x', { event: 'other', level: 'debug', time: 'then' });
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      time: '2027-03-05T22:00:00.000Z',
      level: 'info',
      service: 'api',
      event: 'x',
    });
  });
});
