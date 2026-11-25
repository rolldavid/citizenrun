import { ApiError, lastRequestId } from '@citizenrun/shared';
import type * as Shared from '@citizenrun/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { session } from '@/platform/session';
import type { ClientInfo } from '@/platform/session';
import { PlatformError } from '@/platform/shared';

import {
  buildClientErrorBody,
  CLIENT_ERROR_MAX_BYTES,
  componentFromStack,
  errorCode,
  errorName,
  framesFromStack,
  isChunkLoadError,
  reportClientError,
  reportStaticCode,
  routePattern,
} from './client-errors';

// A plain recording function, not vi.fn: a Vitest spy observes the promises it returns, so a
// rejection from a spy can never be unhandled and the rejection clause below could not fail.
const api = vi.hoisted(() => {
  type Call = [body: unknown, options: unknown];
  const state: { mode: 'resolve' | 'reject'; calls: Call[] } = { mode: 'resolve', calls: [] };
  return { state };
});

vi.mock('@citizenrun/shared/api', async () => {
  const { ApiError } = await vi.importActual<typeof Shared>('@citizenrun/shared');
  return {
    createClientError: (body: unknown, options: unknown): Promise<void> => {
      api.state.calls.push([body, options]);
      return api.state.mode === 'reject'
        ? Promise.reject(new ApiError('unavailable'))
        : Promise.resolve();
    },
  };
});
vi.mock('@citizenrun/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return { ...actual, lastRequestId: vi.fn(() => null) };
});

const CLIENT: ClientInfo = { platform: 'web', appVersion: '2.3.4', header: 'web/2.3.4' };
const REQUEST_ID = '0195d2c4-1a2b-7c3d-8e4f-5a6b7c8d9e0f';

class ChunkLoadError extends Error {
  override readonly name = 'ChunkLoadError';
}

function errorWithStack(stack: string): Error {
  const error = new Error('fixture');
  error.stack = stack;
  return error;
}

function sentBodies(): unknown[] {
  return api.state.calls.map(([body]) => body);
}

beforeEach(() => {
  api.state.mode = 'resolve';
  api.state.calls = [];
  vi.mocked(lastRequestId).mockReset();
  vi.mocked(lastRequestId).mockReturnValue(null);
});

describe('buildClientErrorBody', () => {
  it('the body holds only the fixed fields', () => {
    const body = buildClientErrorBody(
      new TypeError('x'),
      { route: '/office/[slug]', component: 'Screen' },
      'app.render_failed',
      CLIENT,
      REQUEST_ID,
    );
    expect(Object.keys(body).sort()).toEqual([
      'appVersion',
      'code',
      'component',
      'frames',
      'name',
      'platform',
      'requestId',
      'route',
    ]);
    expect(body).toMatchObject({
      name: 'TypeError',
      code: 'app.render_failed',
      route: '/office/[slug]',
      component: 'Screen',
      appVersion: '2.3.4',
      platform: 'web',
      requestId: REQUEST_ID,
    });
  });

  it('no message text is sent', () => {
    const error = new Error('marker-7f3a2b secret text');
    const body = buildClientErrorBody(
      error,
      { route: '/', component: null },
      'app.render_failed',
      CLIENT,
      null,
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain('marker-7f3a2b');
    expect(text).not.toContain('secret');

    reportClientError(error, { route: '/', component: null }, 'app.render_failed');
    const sent = JSON.stringify(sentBodies());
    expect(sent).not.toContain('marker-7f3a2b');
    expect(sent).not.toContain('secret');
  });

  it('the body stays under 4 KB', () => {
    const files = Array.from(
      { length: 20 },
      (_, i) => `/f${String(i).padStart(2, '0')}${'a'.repeat(196)}`,
    );
    expect(files.every((file) => file.length === 200)).toBe(true);
    const stack = [
      'Error: fixture',
      ...files.map((file) => `    at fn (http://localhost:8081${file}:1:1)`),
    ].join('\n');
    const body = buildClientErrorBody(
      errorWithStack(stack),
      { route: '/', component: null },
      'app.render_failed',
      CLIENT,
      null,
    );
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(CLIENT_ERROR_MAX_BYTES);
    expect(body.frames.length).toBeGreaterThan(0);
    expect(body.frames.length).toBeLessThan(20);
    expect(body.frames.map((frame) => frame.file)).toEqual(files.slice(0, body.frames.length));
  });

  it('a body that fails the schema is replaced by the minimal body', () => {
    const body = buildClientErrorBody(
      new TypeError('x'),
      { route: '/office/[slug]', component: 'bad component' },
      'app.render_failed',
      CLIENT,
      REQUEST_ID,
    );
    expect(body).toEqual({
      name: 'Error',
      code: 'app.render_failed',
      route: null,
      component: null,
      appVersion: '2.3.4',
      platform: 'web',
      frames: [],
      requestId: null,
    });
  });
});

describe('the last request id', () => {
  it('the body carries the last request id', () => {
    vi.mocked(lastRequestId).mockReturnValue(REQUEST_ID);
    reportClientError(new Error('x'), { route: '/', component: null }, 'app.render_failed');
    reportStaticCode(new Error('x'), 'app.render_failed');
    vi.mocked(lastRequestId).mockReturnValue(null);
    reportClientError(new Error('x'), { route: '/', component: null }, 'app.render_failed');

    const ids = sentBodies().map((body) => (body as { requestId: unknown }).requestId);
    expect(ids).toEqual([REQUEST_ID, REQUEST_ID, null]);
  });
});

describe('framesFromStack', () => {
  it('frames from a Chrome stack', () => {
    expect(
      framesFromStack(
        'TypeError: x\n    at App (http://localhost:8081/_expo/static/js/web/entry-abc.js?platform=web:12:34)',
      ),
    ).toEqual([{ file: '/_expo/static/js/web/entry-abc.js', line: 12, column: 34 }]);
  });

  it('frames from a Hermes stack', () => {
    expect(
      framesFromStack('TypeError: x\n    at App (address at index.android.bundle:1:2345)'),
    ).toEqual([{ file: 'index.android.bundle', line: 1, column: 2345 }]);
  });

  it('frames from an iOS release stack keep the file name alone', () => {
    const container =
      '/private/var/containers/Bundle/Application/0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0/App.app';
    expect(
      framesFromStack(
        [
          'TypeError: x',
          `    at App (address at ${container}/main.jsbundle:1:2345)`,
          `    at run (file://${container}/main.jsbundle?x=1:2:3)`,
          '    at load (/data/user/0/org.example.app/files/.expo-internal/abc123.bundle:4:5)',
          `start@${container}/main.jsbundle:6:7`,
        ].join('\n'),
      ),
    ).toEqual([
      { file: 'main.jsbundle', line: 1, column: 2345 },
      { file: 'main.jsbundle', line: 2, column: 3 },
      { file: 'abc123.bundle', line: 4, column: 5 },
      { file: 'main.jsbundle', line: 6, column: 7 },
    ]);
  });

  it('a phone frame served by the dev server keeps its path', () => {
    expect(
      framesFromStack(
        '    at App (http://192.168.1.5:8081/index.bundle?platform=ios&dev=true:10:20)',
      ),
    ).toEqual([{ file: '/index.bundle', line: 10, column: 20 }]);
    expect(
      framesFromStack('    at App (HTTPS://example.test/_expo/static/js/web/a.js?v=1#x:1:2)'),
    ).toEqual([{ file: '/_expo/static/js/web/a.js', line: 1, column: 2 }]);
  });

  it('frames from a Safari stack', () => {
    expect(framesFromStack('App@http://localhost:8081/node_modules/x/y.js:3:9')).toEqual([
      { file: '/node_modules/x/y.js', line: 3, column: 9 },
    ]);
  });

  it('a frame outside the file pattern is dropped', () => {
    expect(framesFromStack('    at fn (http://localhost:8081/a b/c.js:1:2)')).toEqual([]);
    expect(framesFromStack('    at fn (http://localhost:8081/a%20b.js:1:2)')).toEqual([]);
    const stack = Array.from(
      { length: 25 },
      (_, i) => `    at fn (http://localhost:8081/f${String(i)}.js:1:2)`,
    ).join('\n');
    const frames = framesFromStack(stack);
    expect(frames).toHaveLength(20);
    expect(frames[0]?.file).toBe('/f0.js');
    expect(frames[19]?.file).toBe('/f19.js');
  });

  it('a stack that is not a string gives no frames', () => {
    expect(framesFromStack(undefined)).toEqual([]);
    expect(framesFromStack(42)).toEqual([]);
  });

  it('a line or column out of range is dropped', () => {
    expect(framesFromStack('    at fn (http://localhost:8081/a.js:10000001:1)')).toEqual([]);
    expect(framesFromStack('    at fn (http://localhost:8081/a.js:1:10000000)')).toEqual([
      { file: '/a.js', line: 1, column: 10_000_000 },
    ]);
  });
});

describe('codes and names', () => {
  it('errors from form, message and location code send the static code only', () => {
    const error = new PlatformError('location', 'location.timeout');
    error.stack = 'PlatformError: location.timeout\n    at fn (http://localhost:8081/a.js:1:2)';
    reportStaticCode(error, 'app.render_failed');
    expect(sentBodies()).toHaveLength(1);
    expect(sentBodies()[0]).toMatchObject({
      name: 'PlatformError',
      code: 'location.timeout',
      route: null,
      component: null,
      frames: [],
    });
  });

  it('codes are static', () => {
    expect(errorCode(new PlatformError('session', 'session.no_origin'), 'app.x')).toBe(
      'session.no_origin',
    );
    expect(errorCode(new ApiError('unavailable'), 'app.x')).toBe('api.unavailable');
    expect(errorCode(new ChunkLoadError('x'), 'app.x')).toBe('app.chunk_load_failed');
    expect(errorCode(new TypeError('x is undefined'), 'app.render_failed')).toBe(
      'app.render_failed',
    );
    expect(errorCode(new TypeError('x'), 'Not A Code')).toBe('app.unknown');
  });

  it('route patterns, never values', () => {
    expect(routePattern(['office', '[slug]'])).toBe('/office/[slug]');
    expect(routePattern(['(tabs)'])).toBe('/(tabs)');
    expect(routePattern([])).toBe('/');
    expect(routePattern(['office', 'a b'])).toBeNull();
    expect(routePattern(['office?x'])).toBeNull();
    expect(routePattern(['a'.repeat(200)])).toBeNull();
  });

  it('the component comes from the component stack', () => {
    expect(componentFromStack('\n    at Broken (file.js:1:1)\n    at Screen')).toBe('Broken');
    expect(componentFromStack('\n    in Broken (created by Screen)')).toBe('Broken');
    expect(componentFromStack('')).toBeNull();
    expect(componentFromStack(undefined)).toBeNull();
    expect(componentFromStack(null)).toBeNull();
  });

  it('chunk-load errors are recognised', () => {
    expect(isChunkLoadError(new ChunkLoadError('x'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: x'))).toBe(
      true,
    );
    expect(isChunkLoadError(new Error('Loading chunk 12 failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('x is undefined'))).toBe(false);
    expect(isChunkLoadError('Loading chunk 12 failed.')).toBe(false);
  });

  it('names are safe', () => {
    expect(errorName(new TypeError())).toBe('TypeError');
    const bad = new Error('x');
    bad.name = 'bad name';
    expect(errorName(bad)).toBe('Error');
    expect(errorName('string')).toBe('NonError');
  });
});

describe('reportClientError', () => {
  it('the report goes through the generated client with keepalive', async () => {
    reportClientError(new Error('x'), { route: '/', component: null }, 'app.render_failed');
    expect(api.state.calls).toHaveLength(1);
    const [body, options] = api.state.calls[0] ?? [];
    expect(options).toEqual({ keepalive: true });
    expect(body).toMatchObject({
      appVersion: '1.0.0',
      platform: 'ios',
      route: '/',
      code: 'app.render_failed',
    });

    // A rejected report is swallowed: no unhandled rejection reaches the process.
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      api.state.mode = 'reject';
      const report = vi.fn(reportClientError);
      report(new Error('x'), { route: '/', component: null }, 'app.render_failed');
      expect(report).toHaveReturnedWith(undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(api.state.calls).toHaveLength(2);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('reporting never throws', () => {
    vi.spyOn(session, 'client', 'get').mockImplementation(() => {
      throw new PlatformError('session', 'session.no_version');
    });
    const report = vi.fn(reportClientError);
    const reportStatic = vi.fn(reportStaticCode);
    report(new Error('x'), { route: '/', component: null }, 'app.render_failed');
    reportStatic(new Error('x'), 'app.render_failed');
    expect(report).toHaveReturnedWith(undefined);
    expect(reportStatic).toHaveReturnedWith(undefined);
    expect(api.state.calls).toHaveLength(0);
  });
});
