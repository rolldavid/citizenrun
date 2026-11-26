import { describe, expect, it } from 'vitest';
import { BrowserExportError, decideRoute, electionIdsFromHtml } from './browser.ts';
import type { RouteDecision, RouteDeps } from './browser.ts';
import { DailyCapError } from './rate.ts';

type Robots = Awaited<ReturnType<RouteDeps['robotsFor']>>;

const ALLOWED: Robots = {
  verdict: { status: 200, kind: 'rules', rules: { groups: [] } },
  decision: 'allowed',
};

/** Route deps that record their calls; the host slot is granted when the test says so. */
function deps(opts: {
  forbidden?: readonly string[];
  robots?: (url: string) => Robots;
  slot?: (host: string) => Promise<() => void>;
}) {
  const calls = { robots: [] as string[], slots: [] as string[], released: 0 };
  const routeDeps: RouteDeps = {
    isForbidden: (host) => (opts.forbidden ?? []).includes(host),
    robotsFor: (url) => {
      calls.robots.push(url);
      return Promise.resolve(opts.robots?.(url) ?? ALLOWED);
    },
    acquireHostSlot: (host) => {
      calls.slots.push(host);
      return (
        opts.slot?.(host) ??
        Promise.resolve(() => {
          calls.released += 1;
        })
      );
    },
  };
  return { routeDeps, calls };
}

describe('decideRoute', () => {
  it('aborts images, fonts and media without asking robots or taking a slot', async () => {
    const { routeDeps, calls } = deps({});
    for (const resourceType of ['image', 'font', 'media']) {
      expect(
        await decideRoute({ url: 'https://a.example.test/x', resourceType }, routeDeps),
      ).toEqual({ action: 'abort', reason: 'resource_type' });
    }
    expect(calls.robots).toEqual([]);
    expect(calls.slots).toEqual([]);
  });

  it('aborts a forbidden host', async () => {
    const { routeDeps, calls } = deps({ forbidden: ['forbidden.example.test'] });
    expect(
      await decideRoute(
        { url: 'https://forbidden.example.test/page', resourceType: 'document' },
        routeDeps,
      ),
    ).toEqual({ action: 'abort', reason: 'forbidden' });
    expect(calls.robots).toEqual([]);
    expect(calls.slots).toEqual([]);
  });

  it('aborts a robots-disallowed path', async () => {
    const { routeDeps, calls } = deps({
      robots: () => ({
        verdict: { status: 200, kind: 'rules', rules: { groups: [] } },
        decision: 'disallowed',
      }),
    });
    expect(
      await decideRoute(
        { url: 'https://a.example.test/CandidateInquiry/Statewide/x', resourceType: 'xhr' },
        routeDeps,
      ),
    ).toEqual({ action: 'abort', reason: 'robots' });
    expect(calls.robots).toEqual(['https://a.example.test/CandidateInquiry/Statewide/x']);
    expect(calls.slots).toEqual([]);
  });

  it('a challenged or unavailable robots.txt aborts with its own reason', async () => {
    const challenged = deps({
      robots: () => ({
        verdict: { status: 403, kind: 'challenge', rules: null },
        decision: 'disallowed',
      }),
    });
    expect(
      await decideRoute(
        { url: 'https://a.example.test/', resourceType: 'document' },
        challenged.routeDeps,
      ),
    ).toEqual({ action: 'abort', reason: 'challenge' });
    const unavailable = deps({
      robots: () => ({
        verdict: { status: 503, kind: 'unavailable', rules: null },
        decision: 'disallowed',
      }),
    });
    expect(
      await decideRoute(
        { url: 'https://a.example.test/', resourceType: 'document' },
        unavailable.routeDeps,
      ),
    ).toEqual({ action: 'abort', reason: 'robots_unavailable' });
  });

  it('aborts a request that is not https', async () => {
    const { routeDeps, calls } = deps({});
    expect(
      await decideRoute({ url: 'http://a.example.test/x', resourceType: 'script' }, routeDeps),
    ).toEqual({ action: 'abort', reason: 'not_https' });
    expect(calls.robots).toEqual([]);
  });

  it('an allowed request continues only after the host slot is granted', async () => {
    let grant: ((release: () => void) => void) | null = null;
    const { routeDeps, calls } = deps({
      robots: () => ({ verdict: { status: 404, kind: 'absent', rules: null }, decision: 'absent' }),
      slot: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    });
    let decided: RouteDecision | null = null;
    const pending = decideRoute(
      { url: 'https://A.example.test/export', resourceType: 'document' },
      routeDeps,
    ).then((decision) => {
      decided = decision;
      return decision;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(decided).toBeNull();
    expect(calls.slots).toEqual(['a.example.test']);
    let released = 0;
    (grant as ((release: () => void) => void) | null)?.(() => {
      released += 1;
    });
    const decision = await pending;
    expect(decision.action).toBe('continue');
    if (decision.action === 'continue') {
      decision.release();
    }
    expect(released).toBe(1);
  });

  it('a daily cap aborts the request', async () => {
    const { routeDeps } = deps({
      slot: (host) => Promise.reject(new DailyCapError(host)),
    });
    expect(
      await decideRoute({ url: 'https://a.example.test/x', resourceType: 'fetch' }, routeDeps),
    ).toEqual({ action: 'abort', reason: 'daily_cap' });
  });
});

describe('electionIdsFromHtml', () => {
  const page = `
    <select id="ddlCounty"><option value="1">Adams 2027</option></select>
    <select id="ddlElection" name="ctl00$ddlElection">
      <option value="">Select an election</option>
      <option value="901">November 2027 General</option>
      <option value="894">February 10, 2026 Special</option>
      <option value="870">November 2025 General</option>
      <option value="abc">2027 Other</option>
      <option value="0">2027 None</option>
      <option value="901">November 2027 General (again)</option>
    </select>`;

  it('reads the first select whose id or name holds "lection", current and later years only', () => {
    expect(electionIdsFromHtml(page, null, 2026)).toEqual([901, 894]);
    expect(electionIdsFromHtml(page, null, 2027)).toEqual([901]);
  });

  it('uses the given selector', () => {
    expect(electionIdsFromHtml(page, '#ddlCounty', 2026)).toEqual([1]);
  });

  it('a selector that matches no select is election_select', () => {
    expect(() => electionIdsFromHtml(page, '#missing', 2026)).toThrow(BrowserExportError);
    const caught = ((): unknown => {
      try {
        electionIdsFromHtml(page, 'div', 2026);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(caught).toMatchObject({ result: 'error', reason: 'election_select' });
  });

  it('a page without an election list has no ids', () => {
    expect(electionIdsFromHtml('<select name="county"></select>', null, 2026)).toEqual([]);
  });
});
