import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_POLICIES } from './rate-limits.ts';

describe('rate-limit policies', () => {
  it("the policies hold the registry's numbers", () => {
    expect(RATE_LIMIT_POLICIES).toEqual({
      'auth.emailStart': [
        { subject: 'ip', action: 'auth_code', limit: 10, window: '1h', store: 'db' },
      ],
      'auth.emailVerify': [
        { subject: 'ip', action: 'auth_verify', limit: 60, window: '1h', store: 'db' },
      ],
      'auth.nonce': [{ subject: 'ip', action: 'auth_nonce', limit: 60, window: '1h', store: 'db' }],
      'auth.token': [{ subject: 'ip', action: 'auth_token', limit: 60, window: '1h', store: 'db' }],
      'auth.appleCallback': [
        { subject: 'ip', action: 'apple_callback', limit: 30, window: '1h', store: 'db' },
      ],
      'auth.appleNotify': [
        { subject: 'ip', action: 'apple_notify', limit: 600, window: '1h', store: 'db' },
      ],
      'dev.mailbox': [
        { subject: 'ip', action: 'dev_mailbox', limit: 120, window: '1m', store: 'memory' },
      ],
      'auth.logout': [
        { subject: 'user', action: 'logout', limit: 30, window: '1m', store: 'db' },
        { subject: 'ip', action: 'logout', limit: 60, window: '1m', store: 'db' },
      ],
      'me.read': [{ subject: 'user', action: 'me_read', limit: 120, window: '1m', store: 'db' }],
      'me.write': [{ subject: 'user', action: 'me_write', limit: 30, window: '1m', store: 'db' }],
      'me.delete': [{ subject: 'user', action: 'me_delete', limit: 5, window: '1h', store: 'db' }],
      'me.export': [{ subject: 'user', action: 'me_export', limit: 10, window: '1h', store: 'db' }],
      'me.handleCheck': [
        { subject: 'user', action: 'handle_check', limit: 60, window: '1m', store: 'db' },
      ],
      'me.handleSet': [
        { subject: 'user', action: 'handle_set', limit: 10, window: '1h', store: 'db' },
      ],
      'ref.read': [
        { subject: 'ip', action: 'ref_read', limit: 120, window: '1m', store: 'memory' },
      ],
      'ref.openapi': [
        { subject: 'ip', action: 'openapi', limit: 30, window: '1m', store: 'memory' },
      ],
      'uploads.create': [
        { subject: 'user', action: 'uploads', limit: 30, window: '1m', store: 'db' },
      ],
      clientErrors: [
        { subject: 'user', action: 'client_err', limit: 20, window: '1m', store: 'db' },
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
      civic_read: [
        { subject: 'user', action: 'civic', limit: 600, window: '1m', store: 'db' },
        {
          subject: 'ip',
          action: 'civic',
          limit: 240,
          window: '1m',
          store: 'memory',
          when: 'logged_out',
        },
      ],
      explore_list: [{ subject: 'user', action: 'explore', limit: 120, window: '1m', store: 'db' }],
      office_toggle: [{ subject: 'user', action: 'toggle', limit: 120, window: '1m', store: 'db' }],
      field_report: [{ subject: 'user', action: 'freport', limit: 5, window: '1m', store: 'db' }],
      'v1.unmatched': [
        { subject: 'ip', action: 'v1_unmatched', limit: 120, window: '1m', store: 'memory' },
      ],
    });
  });

  it('the location, push token, event and suggestion policies are not defined yet', () => {
    for (const name of ['me.location', 'me.pushToken', 'me.events', 'geo.suggest']) {
      expect(Object.hasOwn(RATE_LIMIT_POLICIES, name), name).toBe(false);
    }
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

  it('a user rule always counts in rate_limits, and memory holds only address rules', () => {
    for (const [name, rules] of Object.entries(RATE_LIMIT_POLICIES)) {
      for (const rule of rules) {
        expect(['db', 'memory'], name).toContain(rule.store);
        if (rule.subject === 'user') {
          expect(rule.store, name).toBe('db');
        }
      }
    }
  });
});
