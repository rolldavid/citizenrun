import { describe, expect, it } from 'vitest';
import { CreateClientErrorBodySchema } from './safety.ts';

const FULL_REPORT = {
  name: 'TypeError',
  code: 'render.failed',
  route: '/office/[slug]',
  component: 'OfficeScreen',
  appVersion: '1.4.0',
  platform: 'ios',
  frames: [
    { file: 'src/features/office/office-screen.tsx', line: 42, column: 7 },
    { file: 'node_modules/@scope/pkg/index.js', line: 0, column: 0 },
  ],
  requestId: '0195d2c4-7a1b-7c3d-8e4f-0123456789ab',
} as const;

const FRAME = { file: 'src/app.ts', line: 1, column: 1 };

function withField(key: string, value: unknown): Record<string, unknown> {
  return { ...FULL_REPORT, [key]: value };
}

function withFrame(key: string, value: unknown): Record<string, unknown> {
  return withField('frames', [{ ...FRAME, [key]: value }]);
}

function refused(input: unknown): boolean {
  return !CreateClientErrorBodySchema.safeParse(input).success;
}

describe('CreateClientErrorBodySchema', () => {
  it('a full report parses', () => {
    expect(CreateClientErrorBodySchema.parse(FULL_REPORT)).toEqual(FULL_REPORT);
  });

  it('refuses a name with a space, of 101 characters, or empty', () => {
    expect(refused(withField('name', 'Type Error'))).toBe(true);
    expect(refused(withField('name', 'A'.repeat(101)))).toBe(true);
    expect(refused(withField('name', ''))).toBe(true);
    expect(refused(withField('name', 'A'.repeat(100)))).toBe(false);
  });

  it('refuses a code starting with an upper-case letter or longer than 64', () => {
    expect(refused(withField('code', 'Render.failed'))).toBe(true);
    expect(refused(withField('code', `a${'b'.repeat(64)}`))).toBe(true);
    expect(refused(withField('code', `a${'b'.repeat(63)}`))).toBe(false);
  });

  it('refuses a route with a query, without a leading slash, or longer than 200', () => {
    expect(refused(withField('route', '/search?q=x'))).toBe(true);
    expect(refused(withField('route', 'office/[slug]'))).toBe(true);
    expect(refused(withField('route', `/${'a'.repeat(200)}`))).toBe(true);
    expect(refused(withField('route', `/${'a'.repeat(199)}`))).toBe(false);
  });

  it('refuses a component with a space', () => {
    expect(refused(withField('component', 'Office Screen'))).toBe(true);
  });

  it('refuses an app version of two parts', () => {
    expect(refused(withField('appVersion', '1.0'))).toBe(true);
  });

  it('refuses a platform outside the three', () => {
    expect(refused(withField('platform', 'desktop'))).toBe(true);
  });

  it('refuses 21 frames and takes 20', () => {
    expect(
      refused(
        withField(
          'frames',
          Array.from({ length: 21 }, () => FRAME),
        ),
      ),
    ).toBe(true);
    expect(
      refused(
        withField(
          'frames',
          Array.from({ length: 20 }, () => FRAME),
        ),
      ),
    ).toBe(false);
  });

  it('refuses a frame line of -1 or 10,000,001', () => {
    expect(refused(withFrame('line', -1))).toBe(true);
    expect(refused(withFrame('line', 10_000_001))).toBe(true);
    expect(refused(withFrame('line', 10_000_000))).toBe(false);
  });

  it('refuses a frame file with a space', () => {
    expect(refused(withFrame('file', 'src/a b.ts'))).toBe(true);
  });

  it('refuses a request id that is not a uuid', () => {
    expect(refused(withField('requestId', 'abc'))).toBe(true);
  });

  it('accepts null for route, component and requestId', () => {
    const parsed = CreateClientErrorBodySchema.parse({
      ...FULL_REPORT,
      route: null,
      component: null,
      requestId: null,
    });
    expect(parsed).toMatchObject({ route: null, component: null, requestId: null });
  });

  it('unknown keys are dropped', () => {
    const parsed = CreateClientErrorBodySchema.parse({
      ...FULL_REPORT,
      message: 'free text',
      stack: 'Error: free text',
    });
    expect(parsed).not.toHaveProperty('message');
    expect(parsed).not.toHaveProperty('stack');
    expect(parsed).toEqual(FULL_REPORT);
  });
});
