// The route classes of the web shell and the app's guard (L-route-classes, D-537): one table both read.
// The public app has no admin route, so `/admin` and the paths under it are `unknown` (D-801).

export type RouteClass = 'public' | 'auth' | 'onboarding' | 'session' | 'dev' | 'unknown';

export type RouteClassRow = {
  readonly routeClass: Exclude<RouteClass, 'unknown'>;
  readonly patterns: readonly string[];
};

/** The class table as data, in its order; `:name` is one segment and a final `*` one or more. */
export const ROUTE_CLASSES: readonly RouteClassRow[] = [
  { routeClass: 'public', patterns: ['/', '/office/:slug', '/c/:slug', '/u/:handle', '/p/:id'] },
  { routeClass: 'auth', patterns: ['/welcome', '/sign-in'] },
  {
    routeClass: 'onboarding',
    patterns: [
      '/onboarding/photo',
      '/onboarding/handle',
      '/onboarding/issues',
      '/onboarding/location',
    ],
  },
  {
    routeClass: 'session',
    patterns: [
      '/explore',
      '/create',
      '/activity',
      '/profile',
      '/messages',
      '/messages/requests',
      '/messages/:id',
      '/office/:slug/run',
      '/settings',
      '/settings/*',
    ],
  },
  { routeClass: 'dev', patterns: ['/dev/*'] },
];

// One pattern segment: a literal to match exactly, or null for a `:name` segment.
type CompiledPattern = { readonly segments: readonly (string | null)[]; readonly hasRest: boolean };
type CompiledRow = {
  readonly routeClass: RouteClassRow['routeClass'];
  readonly patterns: readonly CompiledPattern[];
};

const QUERY_OR_FRAGMENT = /[?#]/;

function splitPath(path: string): string[] {
  return path === '/' ? [] : path.slice(1).split('/');
}

function compilePattern(pattern: string): CompiledPattern {
  const parts = splitPath(pattern);
  const hasRest = parts[parts.length - 1] === '*';
  const fixed = hasRest ? parts.slice(0, -1) : parts;
  return {
    segments: fixed.map((part) => (part.startsWith(':') ? null : part)),
    hasRest,
  };
}

// Compiled once at load: the function runs on every navigation and first load.
const COMPILED: readonly CompiledRow[] = ROUTE_CLASSES.map((row) => ({
  routeClass: row.routeClass,
  patterns: row.patterns.map(compilePattern),
}));

function matches(pattern: CompiledPattern, segments: readonly string[]): boolean {
  const fixed = pattern.segments.length;
  if (pattern.hasRest ? segments.length <= fixed : segments.length !== fixed) {
    return false;
  }
  return pattern.segments.every(
    (literal, index) => literal === null || literal === segments[index],
  );
}

/** The class of a URL path; 'unknown' for any path no row matches, a path without a leading '/' included. */
export function routeClassOf(path: string): RouteClass {
  const cut = QUERY_OR_FRAGMENT.exec(path);
  let bare = cut === null ? path : path.slice(0, cut.index);
  if (!bare.startsWith('/')) {
    return 'unknown';
  }
  if (bare !== '/' && bare.endsWith('/')) {
    bare = bare.slice(0, -1);
  }
  const segments = splitPath(bare);
  if (segments.some((segment) => segment === '')) {
    return 'unknown';
  }
  for (const row of COMPILED) {
    if (row.patterns.some((pattern) => matches(pattern, segments))) {
      return row.routeClass;
    }
  }
  return 'unknown';
}
