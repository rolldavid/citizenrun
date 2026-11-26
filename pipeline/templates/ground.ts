// PIPE-templates step 3: every cited quote checked against the text of its page, fetched once per
// URL through the fetcher. Grounding never throws for a fetch outcome and never fails the stage
// (P8-18).
import { assertNever } from '@citizenrun/shared';
import { extractHtmlText } from '../crawlers/text-html.ts';
import { PdfUnreadable, extractPdfText } from '../crawlers/text-pdf.ts';
import { storeText } from '../crawlers/text-store.ts';
import { isQuoteGrounded, textKeys } from '../extract/grounding.ts';
import type { FetchResult } from '../lib/fetch/types.ts';
import type { RunContext } from '../lib/runner.ts';
import type { CitedNode } from './cited.ts';

export type QuoteReason =
  | 'grounded'
  | 'carried'
  | 'not_found'
  | 'refused'
  | 'challenge'
  | 'fetch_error'
  | 'not_https'
  | 'unsupported_type'
  | 'no_text_layer'
  | 'pdf_unreadable';

export const QUOTE_REASONS = [
  'grounded',
  'carried',
  'not_found',
  'refused',
  'challenge',
  'fetch_error',
  'not_https',
  'unsupported_type',
  'no_text_layer',
  'pdf_unreadable',
] as const satisfies readonly QuoteReason[];

export type GroundedMark = {
  readonly grounded: boolean;
  readonly checked_at: string | null;
  readonly text_sha256: string | null;
  readonly reason: QuoteReason;
};

export type GroundItem = { readonly path: string; readonly node: CitedNode };

export type PreviousMarks = Readonly<
  Record<string, GroundedMark & { readonly source_url: string; readonly quote: string }>
>;

/** The outcome of reading one page: its text, or why it has none. */
type PageText =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'none'; readonly reason: QuoteReason };

/** A fetch outcome that gives no page: the reason a quote of that page stays ungrounded. */
function refusalReason(result: Exclude<FetchResult, { kind: 'ok' }>): QuoteReason {
  switch (result.kind) {
    case 'disallowed':
      return result.reason === 'not_https' ? 'not_https' : 'refused';
    case 'challenge':
      return 'challenge';
    case 'error':
    case 'not_modified':
      return 'fetch_error';
    default:
      return assertNever(result);
  }
}

function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

async function pageText(
  ctx: RunContext,
  result: Extract<FetchResult, { kind: 'ok' }>,
): Promise<PageText> {
  const body = await ctx.bucket.getBytes(result.cacheKey);
  if (body === null) {
    return { kind: 'none', reason: 'fetch_error' };
  }
  switch (mediaType(result.contentType)) {
    case 'text/html':
    case 'application/xhtml+xml':
      return { kind: 'text', text: extractHtmlText(new TextDecoder('utf-8').decode(body)) };
    case 'application/pdf': {
      try {
        const pdf = await extractPdfText(body);
        return pdf.hasTextLayer
          ? { kind: 'text', text: pdf.text }
          : { kind: 'none', reason: 'no_text_layer' };
      } catch (error) {
        if (error instanceof PdfUnreadable) {
          return { kind: 'none', reason: 'pdf_unreadable' };
        }
        throw error;
      }
    }
    case 'text/plain':
      return { kind: 'text', text: new TextDecoder('utf-8').decode(body).normalize('NFC') };
    default:
      return { kind: 'none', reason: 'unsupported_type' };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}

/**
 * One mark per item, keyed by its path. A page that cannot be fetched carries forward an earlier
 * grounding of the same path, URL and quote with its own `checked_at` (reason `carried`), so the
 * 180-day freshness counts from the last successful check; any other quote of it is ungrounded.
 */
export async function groundCited(
  ctx: RunContext,
  items: readonly GroundItem[],
  opts: { readonly state: string | null; readonly previous: PreviousMarks | null },
): Promise<Record<string, GroundedMark>> {
  const byUrl = new Map<string, GroundItem[]>();
  for (const item of items) {
    const list = byUrl.get(item.node.source_url);
    if (list === undefined) {
      byUrl.set(item.node.source_url, [item]);
    } else {
      list.push(item);
    }
  }
  const checkedAt = ctx.now.toISOString();
  const marks: Record<string, GroundedMark> = {};
  for (const [url, group] of byUrl) {
    const result = await ctx.fetcher.fetch({
      url,
      class: 'crawl',
      method: 'GET',
      ...(opts.state === null ? {} : { state: opts.state }),
    });
    let page: PageText;
    if (result.kind === 'ok') {
      page = await pageText(ctx, result);
    } else {
      page = { kind: 'none', reason: refusalReason(result) };
    }
    if (page.kind === 'text') {
      const sha = await storeText(ctx.bucket, page.text);
      const keys = textKeys(page.text);
      for (const { path, node } of group) {
        marks[path] = isQuoteGrounded(node.quote, keys)
          ? { grounded: true, checked_at: checkedAt, text_sha256: sha, reason: 'grounded' }
          : { grounded: false, checked_at: checkedAt, text_sha256: sha, reason: 'not_found' };
      }
    } else if (result.kind === 'ok') {
      // The page was read but holds no text to check the quote against.
      for (const { path } of group) {
        marks[path] = { grounded: false, checked_at: null, text_sha256: null, reason: page.reason };
      }
    } else {
      for (const { path, node } of group) {
        const earlier = opts.previous?.[path];
        marks[path] =
          earlier !== undefined &&
          earlier.grounded &&
          earlier.source_url === node.source_url &&
          earlier.quote === node.quote
            ? {
                grounded: true,
                checked_at: earlier.checked_at,
                text_sha256: earlier.text_sha256,
                reason: 'carried',
              }
            : { grounded: false, checked_at: null, text_sha256: null, reason: page.reason };
      }
    }
    ctx.log.info('templates.ground', {
      host: hostOf(url),
      result: result.kind,
      quotes: group.length,
    });
  }
  return marks;
}
