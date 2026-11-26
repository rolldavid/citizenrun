# Crawl policy

This page is for people who run websites that CitizenRun reads, and for anyone who wants to know how it collects public information.

## What CitizenRun collects and why

CitizenRun is an open-source, non-commercial app that helps people find the elected offices on their ballot and learn what it takes to run for one. To do that it collects public records about elected offices: who holds them, when they are up for election, filing deadlines and requirements, and candidate lists. It collects them from government websites and from public datasets.

## How to recognise our crawler

Every request our crawler makes carries this user agent:

```text
CitizenRunBot/<version> (+https://github.com/rolldavid/citizenrun/blob/main/docs/crawl-policy.md)
```

`<version>` is the version of the crawler. The product token to use in robots.txt is `CitizenRunBot`.

## robots.txt

- We read a site's robots.txt before our first request to that host, and follow it as RFC 9309 describes.
- If robots.txt has a group for `CitizenRunBot`, that group applies; otherwise the `*` group applies.
- We keep a copy of robots.txt for at most 24 hours before reading it again.
- If robots.txt answers with a server error, or cannot be reached, we make no requests to that host that day.
- We ignore `Crawl-delay`, which is not part of the standard; the pace below applies to every host.

To block our crawler from your whole site, add these two lines to your robots.txt:

```text
User-agent: CitizenRunBot
Disallow: /
```

## Pace

- At most one request every two seconds to each host, over one connection.
- At most 2,000 requests to each host in a day.
- Conditional requests (`If-None-Match` and `If-Modified-Since`), so a page that has not changed is not sent again.
- We honour `Retry-After`, and back off and retry less often when a host answers 429 or 503.
- Website pages are read outside 08:00 to 18:00 on weekdays, in the state's time zone.
- No requests to election results servers on election nights.

## Public pages only

We read only what a visitor without an account can see. We never sign in, create an account, solve or get around a CAPTCHA, click through a terms page, or use an undocumented API that needs a key.

## When a site refuses us

If a site blocks us or shows a challenge page, we stop. We never rotate network addresses, use proxies, disguise our user agent or work around a challenge. A maintainer may instead fetch the same public pages once by hand from their own computer, under the same rules, or ask the office for the data.

## Personal data

Candidate lists can contain home addresses and phone numbers. These are never published or shown in the app: they are dropped when a list is read. The private raw copies of the lists are deleted after 400 days.

## Sources we do not use

We do not use a source whose terms forbid automated collection or reuse of its data.

## How to reach us

To ask a question or report a problem, open an issue at <https://github.com/rolldavid/citizenrun/issues>. To stop our crawler at once, use robots.txt as shown above: we read it again within 24 hours.
