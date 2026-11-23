import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_POLICIES } from './rate-limits.ts';

describe('rate-limit policies', () => {
  it("the policies hold the registry's numbers", () => {
    expect(RATE_LIMIT_POLICIES).toEqual({
      'ref.openapi': [
        { subject: 'ip', action: 'openapi', limit: 30, window: '1m', store: 'memory' },
      ],
      clientErrors: [
        { subject: 'user', action: 'client_err', limit: 20, window: '1m', store: 'memory' },
        { subject: 'ip', action: 'client_err', limit: 20, window: '1m', store: 'memory' },
      ],
      web_health: [
        { subject: 'ip', action: 'web_health', limit: 600, window: '1m', store: 'memory' },
      ],
      web_static: [
        { subject: 'ip', action: 'web_static', limit: 1200, window: '1m', store: 'memory' },
      ],
      web_page: [{ subject: 'ip', action: 'web_page', limit: 240, window: '1m', store: 'memory' }],
      web_seo: [{ subject: 'ip', action: 'web_seo', limit: 120, window: '1m', store: 'memory' }],
    });
  });

  it('no policy is unlimited', () => {
    for (const [name, rules] of Object.entries(RATE_LIMIT_POLICIES)) {
      expect(rules.length, name).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(Number.isInteger(rule.limit) && rule.limit > 0, name).toBe(true);
      }
    }
  });

  it('actions are lower snake_case and windows valid', () => {
    for (const rules of Object.values(RATE_LIMIT_POLICIES)) {
      for (const rule of rules) {
        expect(rule.action).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
        expect(['1m', '1h', '1d']).toContain(rule.window);
        expect(['user', 'ip']).toContain(rule.subject);
      }
    }
  });

  it('no rule uses the db store', () => {
    const stores = new Set<string>(
      Object.values(RATE_LIMIT_POLICIES).flatMap((rules) => rules.map((rule) => rule.store)),
    );
    expect([...stores]).toEqual(['memory']);
  });
});
