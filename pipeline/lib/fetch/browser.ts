// A headless browser for form-driven sources only (D-325 class b): pages whose list a visitor gets
// by pressing an export control. Images, fonts and media are never loaded. Every request the page
// makes passes `decideRoute`, so robots.txt, forbidden hosts, the host slot and the daily cap hold
// for each of them (D-331); a challenge stops the host as the fetcher's own requests do (D-087).
import { load } from 'cheerio';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Locator, Page, Request, Route } from 'playwright';
import type { Logger } from '@citizenrun/shared';
import { isChallenge } from './challenge.ts';
import type { PipelineFetcher } from './fetcher.ts';
import { DailyCapError } from './rate.ts';

/** Wait for the export's download (rule 10's page limit). */
export const DOWNLOAD_TIMEOUT_MS = 120_000;
/** Page loads take at most this long (rule 10). */
export const PAGE_LOAD_TIMEOUT_MS = 120_000;
/** The most bytes an export may hold (the download limit of PIPE-fetch). */
export const EXPORT_MAX_BYTES = 200_000_000;
/**
 * The longest a request of the page holds its host's slot. A request the browser never reports as
 * finished (one still open when its page closes, or a long poll) gives the slot back then.
 */
export const SLOT_HOLD_MAX_MS = 120_000;

const ABORTED_TYPES: ReadonlySet<string> = new Set(['image', 'font', 'media']);

/** What the route handler needs to know about one request the page makes. */
export type RouteRequest = {
  readonly url: string;
  readonly resourceType: string;
};

/** The parts of the fetcher the route decision uses. */
export type RouteDeps = Pick<PipelineFetcher, 'isForbidden' | 'robotsFor' | 'acquireHostSlot'>;

export type RouteAbortReason =
  | 'resource_type'
  | 'not_https'
  | 'forbidden'
  | 'robots'
  | 'robots_unavailable'
  | 'challenge'
  | 'daily_cap';

export type RouteDecision =
  | { readonly action: 'abort'; readonly reason: RouteAbortReason }
  | { readonly action: 'continue'; readonly release: () => void };

function abort(reason: RouteAbortReason): RouteDecision {
  return { action: 'abort', reason };
}

/**
 * The route handler's decision for one request: aborted when it is an image, font or media
 * request, not https, to a forbidden host or a path robots.txt refuses; otherwise it continues once
 * the host's slot is granted, and `release` gives the slot back when the request ends.
 */
export async function decideRoute(request: RouteRequest, deps: RouteDeps): Promise<RouteDecision> {
  if (ABORTED_TYPES.has(request.resourceType)) {
    return abort('resource_type');
  }
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return abort('not_https');
  }
  if (url.protocol !== 'https:') {
    return abort('not_https');
  }
  const host = url.hostname.toLowerCase();
  if (deps.isForbidden(host)) {
    return abort('forbidden');
  }
  const { verdict, decision } = await deps.robotsFor(url.href);
  if (decision === 'disallowed') {
    switch (verdict.kind) {
      case 'challenge':
        return abort('challenge');
      case 'unavailable':
        return abort('robots_unavailable');
      case 'rules':
      case 'absent':
        return abort('robots');
    }
  }
  try {
    const release = await deps.acquireHostSlot(host);
    return { action: 'continue', release };
  } catch (error) {
    if (error instanceof DailyCapError) {
      return abort('daily_cap');
    }
    throw error;
  }
}

/** How a browser export ended when it saved nothing. Its reason never holds a URL. */
export class BrowserExportError extends Error {
  override readonly name = 'BrowserExportError';
  readonly result: 'disallowed' | 'challenge' | 'error';
  readonly reason: string;

  constructor(result: 'disallowed' | 'challenge' | 'error', reason: string) {
    super(`${result}: ${reason}`);
    this.result = result;
    this.reason = reason;
  }
}

/** What an aborted main document means for the export. */
function mainDocumentError(reason: RouteAbortReason | 'failed'): BrowserExportError {
  switch (reason) {
    case 'challenge':
      return new BrowserExportError('challenge', 'robots_challenge');
    case 'robots':
    case 'robots_unavailable':
    case 'daily_cap':
    case 'not_https':
      return new BrowserExportError('disallowed', reason);
    case 'forbidden':
      return new BrowserExportError('disallowed', 'blocked_host');
    case 'resource_type':
    case 'failed':
      return new BrowserExportError('error', 'load');
  }
}

const POSITIVE_INTEGER = /^[1-9]\d{0,9}$/;
const FOUR_DIGITS = /(?<!\d)\d{4}(?!\d)/g;

/**
 * The election ids of a page's election list (PIPE-snapshot-archiver): the element
 * `electionSelect` selects, else the first `select` whose id or name contains `lection`; the values
 * of its options that are positive integers and whose label holds a four-digit year not earlier
 * than `year`, in page order. A given selector that matches no `select` is `election_select`.
 */
export function electionIdsFromHtml(
  html: string,
  electionSelect: string | null,
  year: number,
): readonly number[] {
  const $ = load(html);
  let list;
  if (electionSelect !== null) {
    try {
      list = $(electionSelect).filter('select').first();
    } catch {
      throw new BrowserExportError('error', 'election_select');
    }
    if (list.length === 0) {
      throw new BrowserExportError('error', 'election_select');
    }
  } else {
    list = $('select')
      .filter((_index, element) => {
        const id = $(element).attr('id') ?? '';
        const name = $(element).attr('name') ?? '';
        return /lection/i.test(id) || /lection/i.test(name);
      })
      .first();
  }
  const ids: number[] = [];
  list.find('option').each((_index, element) => {
    const option = $(element);
    const value = (option.attr('value') ?? option.text()).trim();
    if (!POSITIVE_INTEGER.test(value)) {
      return;
    }
    const label = option.attr('label') ?? option.text();
    const years = [...label.matchAll(FOUR_DIGITS)].map((match) => Number(match[0]));
    if (!years.some((found) => found >= year)) {
      return;
    }
    const id = Number(value);
    if (!ids.includes(id)) {
      ids.push(id);
    }
  });
  return ids;
}

export interface BrowserSession {
  readElectionIds(
    pageUrl: string,
    state: string,
    electionSelect: string | null,
  ): Promise<readonly number[]>;
  exportDownload(opts: {
    pageUrl: string;
    buttonText: string;
    state: string;
  }): Promise<{ bytes: Uint8Array; suggestedName: string; finalUrl: string; status: number }>;
  close(): Promise<void>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isMainDocument(request: Request): boolean {
  try {
    return request.isNavigationRequest() && request.frame().parentFrame() === null;
  } catch {
    // A service worker's request has no frame.
    return false;
  }
}

/** Reads a download's stream into memory, refusing more than `max` bytes. */
async function readCapped(
  stream: NodeJS.ReadableStream & { destroy(): void },
  max: number,
): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.byteLength;
    if (total > max) {
      stream.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Opens one headless Chromium context with the fetcher's user agent, downloads accepted and no
 * stored state. The caller closes the session.
 */
export async function openBrowserSession(
  fetcher: PipelineFetcher,
  log: Logger,
): Promise<BrowserSession> {
  const browser: Browser = await chromium.launch({ headless: true });
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      userAgent: fetcher.userAgent,
      acceptDownloads: true,
      javaScriptEnabled: true,
      // A service worker's requests would bypass the route below.
      serviceWorkers: 'block',
    });
  } catch (error) {
    await browser.close();
    throw error;
  }
  const held = new Map<Request, { give: () => void; timer: ReturnType<typeof setTimeout> }>();
  const statuses = new Map<string, number>();
  // The reason the current page's main document was refused, if it was.
  let mainAbort: RouteAbortReason | 'failed' | null = null;
  // Read through a function: the route handler sets it while a page call is awaited.
  const refusedMain = (): RouteAbortReason | 'failed' | null => mainAbort;

  const release = (request: Request): void => {
    const slot = held.get(request);
    if (slot !== undefined) {
      held.delete(request);
      clearTimeout(slot.timer);
      slot.give();
    }
  };

  /** Pages are used one at a time, so once a page is closed none of its requests holds a slot. */
  const releaseAll = (): void => {
    for (const request of [...held.keys()]) {
      release(request);
    }
  };

  const closePage = async (page: Page): Promise<void> => {
    try {
      await page.close();
    } finally {
      releaseAll();
    }
  };

  const handle = async (route: Route): Promise<void> => {
    const request = route.request();
    const main = isMainDocument(request);
    let decision: RouteDecision;
    try {
      decision = await decideRoute(
        { url: request.url(), resourceType: request.resourceType() },
        fetcher,
      );
    } catch {
      if (main) {
        mainAbort = 'failed';
      }
      await route.abort('failed').catch(() => undefined);
      return;
    }
    if (decision.action === 'abort') {
      if (main) {
        mainAbort = decision.reason;
      }
      if (decision.reason !== 'resource_type') {
        log.info('browser.request_refused', {
          host: hostOf(request.url()),
          resourceType: request.resourceType(),
          reason: decision.reason,
        });
      }
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    const timer = setTimeout(() => {
      release(request);
    }, SLOT_HOLD_MAX_MS);
    timer.unref();
    held.set(request, { give: decision.release, timer });
    try {
      await route.continue();
    } catch {
      release(request);
    }
  };

  // Routed on the context, so pop-ups and the download request are covered too.
  await context.route('**/*', handle);
  context.on('requestfinished', release);
  context.on('requestfailed', release);
  context.on('response', (response) => {
    statuses.set(response.url(), response.status());
  });

  /** Loads a page; a refused main document or a challenge ends the export. */
  const loadPage = async (pageUrl: string, state: string): Promise<Page> => {
    mainAbort = null;
    statuses.clear();
    const page = await context.newPage();
    let response;
    try {
      response = await page.goto(pageUrl, { waitUntil: 'load', timeout: PAGE_LOAD_TIMEOUT_MS });
    } catch {
      await closePage(page);
      throw mainDocumentError(refusedMain() ?? 'failed');
    }
    if (response === null) {
      await closePage(page);
      throw new BrowserExportError('error', 'load');
    }
    const status = response.status();
    let text = '';
    try {
      text = await response.text();
    } catch {
      text = '';
    }
    if (isChallenge(status, text) || status === 403) {
      await fetcher.reportChallenge(hostOf(pageUrl), status, {
        url: pageUrl,
        class: 'adapter',
        state,
        purpose: 'cache',
      });
      await closePage(page);
      throw new BrowserExportError('challenge', `http_${String(status)}`);
    }
    if (status < 200 || status >= 300) {
      await closePage(page);
      throw new BrowserExportError('error', `http_${String(status)}`);
    }
    mainAbort = null;
    return page;
  };

  const findControl = async (page: Page, text: string): Promise<Locator | null> => {
    const candidates = [
      page.getByRole('button', { name: text }),
      page.getByRole('link', { name: text }),
      page.getByText(text, { exact: true }),
      // An image-style submit control whose only name is its title (a grid's export icon).
      page.getByTitle(text, { exact: true }),
    ];
    for (const candidate of candidates) {
      if ((await candidate.count()) > 0) {
        return candidate.first();
      }
    }
    return null;
  };

  return {
    async readElectionIds(pageUrl, state, electionSelect) {
      const page = await loadPage(pageUrl, state);
      try {
        return electionIdsFromHtml(
          await page.content(),
          electionSelect,
          new Date().getUTCFullYear(),
        );
      } finally {
        await closePage(page);
      }
    },

    async exportDownload({ pageUrl, buttonText, state }) {
      const page = await loadPage(pageUrl, state);
      try {
        const control = await findControl(page, buttonText);
        if (control === null) {
          throw new BrowserExportError('error', 'export_control');
        }
        // Never typed into: the control is pressed as a visitor presses it (7.1 rule 2).
        const waiting = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS });
        waiting.catch(() => undefined);
        try {
          await control.click();
        } catch {
          throw new BrowserExportError('error', 'click');
        }
        let download;
        try {
          download = await waiting;
        } catch {
          const refused = refusedMain();
          throw refused === null
            ? new BrowserExportError('error', 'no_download')
            : mainDocumentError(refused);
        }
        const stream = await download.createReadStream();
        const bytes = await readCapped(stream, EXPORT_MAX_BYTES);
        if (bytes === null) {
          await download.cancel();
          await download.delete().catch(() => undefined);
          throw new BrowserExportError('error', 'too_large');
        }
        const finalUrl = download.url();
        const suggestedName = download.suggestedFilename();
        await download.delete();
        // A download event follows a successful answer; its status is read when the page saw it.
        const status = statuses.get(finalUrl) ?? 200;
        return { bytes, suggestedName, finalUrl, status };
      } finally {
        await closePage(page);
      }
    },

    async close() {
      releaseAll();
      await context.close();
      await browser.close();
    },
  };
}
