import { BRAND, brandVariant, routeClassOf, siteOrigin } from '@citizenrun/shared';
import type { BrandVariantName, OnboardingStep, RouteClass } from '@citizenrun/shared';
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { assertRouterPath } from '@/lib/router-path';
import type { Href } from '@/lib/view-models/common.types';
import { session } from '@/platform/session';

export type NavItemId = 'home' | 'explore' | 'post' | 'activity' | 'messages' | 'profile';
export type Breakpoint = 'compact' | 'medium' | 'expanded';
export type GuardSystemScreen = 'update' | 'adultsOnly';
export type GuardSession =
  | { kind: 'none' } // no session
  | { kind: 'pending' } // a session may exist; Me not loaded
  | { kind: 'ready'; onboardingStep: OnboardingStep; role: 'user' | 'admin' };
export type GuardInput = {
  path: string; // the target's path, no query string, no hash
  next: string | null; // the target's raw `next` query parameter
  rememberedNext: string | null; // rule N3
  session: GuardSession;
  upgradeBlocked: boolean; // the last /v1 answer was 426 and links.reloadOnce answered false
  ageGateBlocked: boolean; // ageAssurance.gateBlockedUntil() is not null
  landingPageSupported: boolean; // SCR-root-layout
  revealShowing: boolean; // SCR-onboarding-reveal
  breakpoint: Breakpoint;
  devRoutesAllowed: boolean; // SCR-root-layout
};
export type GuardResult =
  { kind: 'stay' } | { kind: 'redirect'; to: Href } | { kind: 'system'; screen: GuardSystemScreen };

export const ONBOARDING_STEPS = ['photo', 'handle', 'issues', 'location'] as const;
type OnboardingStepName = (typeof ONBOARDING_STEPS)[number];

// SCR-root-layout, SCR-not-found
const BARE_CLASSES: ReadonlySet<RouteClass> = new Set(['auth', 'onboarding', 'dev', 'unknown']);
const NOT_FOLLOWED_BY_NEXT: ReadonlySet<RouteClass> = new Set(['auth', 'onboarding']);
const ONBOARDING_PREFIX = '/onboarding/';

// 06a 4.6, rule N1
export function safeInternalPath(path: string | null): string {
  if (path === null || !path.startsWith('/')) {
    return '/';
  }
  const second = path.charAt(1);
  return second === '/' || second === '\\' ? '/' : path;
}

// Rules N1, N3
export function nextPathOf(raw: string | null): string | null {
  if (raw === null || raw === '') {
    return null;
  }
  const cut = /[?#]/.exec(raw);
  const path = safeInternalPath(cut === null ? raw : raw.slice(0, cut.index));
  return NOT_FOLLOWED_BY_NEXT.has(routeClassOf(path)) ? null : path;
}

// SCR-welcome
export function welcomeHref(next: string | null): Href {
  const path = nextPathOf(next);
  return path === null || path === '/' ? '/welcome' : `/welcome?next=${encodeURIComponent(path)}`;
}

// Rule N4
export function signInHref(path: string): Href {
  return path === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(path)}`;
}

export function onboardingHref(step: OnboardingStepName): Href {
  return `${ONBOARDING_PREFIX}${step}`;
}

function stepOfPath(path: string): OnboardingStepName | null {
  const segment = path.slice(ONBOARDING_PREFIX.length).split('/')[0] ?? '';
  return ONBOARDING_STEPS.find((step) => step === segment) ?? null;
}

const STAY: GuardResult = { kind: 'stay' };

function redirect(to: Href): GuardResult {
  return { kind: 'redirect', to };
}

// SCR-root-layout guards, rows D and 1 to 13
export function resolveGuard(input: GuardInput): GuardResult {
  const cls = routeClassOf(input.path);
  const { session: current } = input;

  if (cls === 'dev') {
    return input.devRoutesAllowed ? STAY : redirect('/');
  }
  if (input.upgradeBlocked) {
    return { kind: 'system', screen: 'update' };
  }
  if (input.ageGateBlocked && (cls === 'auth' || cls === 'onboarding')) {
    return { kind: 'system', screen: 'adultsOnly' };
  }

  if (current.kind === 'none') {
    if (cls === 'public' && input.path === '/' && !input.landingPageSupported) {
      return redirect(welcomeHref(input.next));
    }
    if (cls === 'public' || cls === 'auth') {
      return STAY;
    }
    if (cls === 'onboarding') {
      return redirect('/welcome');
    }
    if (cls === 'session') {
      return redirect(signInHref(input.path));
    }
    return STAY;
  }

  if (current.kind === 'pending') {
    return STAY;
  }

  const step = current.onboardingStep;
  if (step !== 'done') {
    if (cls !== 'onboarding') {
      return redirect(onboardingHref(step));
    }
    const pathStep = stepOfPath(input.path);
    if (pathStep !== null && ONBOARDING_STEPS.indexOf(pathStep) > ONBOARDING_STEPS.indexOf(step)) {
      return redirect(onboardingHref(step));
    }
    return STAY;
  }

  if ((cls === 'auth' || cls === 'onboarding') && !input.revealShowing) {
    return redirect(nextPathOf(input.next) ?? nextPathOf(input.rememberedNext) ?? '/');
  }
  if (input.path === '/create' && input.breakpoint !== 'compact') {
    return redirect('/');
  }
  return STAY;
}

// AppShellProps.mode
export function shellModeFor(path: string, systemReplacesNavigator: boolean): 'app' | 'bare' {
  return systemReplacesNavigator || BARE_CLASSES.has(routeClassOf(path)) ? 'bare' : 'app';
}

const TAB_ITEMS: Readonly<Record<string, NavItemId>> = {
  '/': 'home',
  '/explore': 'explore',
  '/create': 'post',
  '/activity': 'activity',
  '/profile': 'profile',
};

export function tabItemOf(path: string): NavItemId | null {
  return Object.hasOwn(TAB_ITEMS, path) ? (TAB_ITEMS[path] ?? null) : null;
}

let rememberedTab: NavItemId | null = null;

function isAt(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

// AppShellProps.active, PC6B-11
export function activeItemFor(path: string): NavItemId | null {
  const tab = tabItemOf(path);
  if (tab !== null) {
    return tab;
  }
  if (isAt(path, '/messages')) {
    return 'messages';
  }
  if (isAt(path, '/settings')) {
    return 'profile';
  }
  if (BARE_CLASSES.has(routeClassOf(path))) {
    return null;
  }
  return rememberedTab;
}

export function rememberTabItem(item: NavItemId): void {
  rememberedTab = item;
}

const SIGNED_IN_TARGETS: Readonly<Record<NavItemId, Href>> = {
  home: '/',
  explore: '/explore',
  post: '/create',
  activity: '/activity',
  messages: '/messages',
  profile: '/settings',
};

// AppShellProps.onNavigate
export function navTargetFor(item: NavItemId, signedIn: boolean): Href {
  const target = SIGNED_IN_TARGETS[item];
  return signedIn || item === 'home' ? target : signInHref(target);
}

// AppShellProps.onReselect
export function tabRootFor(item: NavItemId): Href {
  return SIGNED_IN_TARGETS[item];
}

export function isAtLocation(to: Href, path: string, next: string | null): boolean {
  const mark = to.indexOf('?');
  const toPath = mark === -1 ? to : to.slice(0, mark);
  const query = mark === -1 ? '' : to.slice(mark + 1);
  return toPath === path && new URLSearchParams(query).get('next') === next;
}

// Rule N3
let rememberedNext: string | null = null;

export function rememberNext(raw: string | null): void {
  rememberedNext = nextPathOf(raw);
}

export function peekRememberedNext(): string | null {
  return rememberedNext;
}

export function clearRememberedNext(): void {
  rememberedNext = null;
}

let trackedPath = '/';

export function trackCurrentPath(path: string): void {
  trackedPath = path;
}

export function currentPath(): string {
  return trackedPath;
}

type RouterOp = 'push' | 'replace' | 'dismissTo';

let navigationReady = false;
let heldNavigation: { op: RouterOp; path: string } | null = null;

function perform(op: RouterOp, path: string): void {
  const target = safeInternalPath(path);
  assertRouterPath(target); // checked by safeInternalPath; typed routes do not list every path
  switch (op) {
    case 'push':
      router.push(target);
      return;
    case 'replace':
      router.replace(target);
      return;
    case 'dismissTo':
      router.dismissTo(target);
      return;
  }
}

function request(op: RouterOp, path: string): void {
  if (!navigationReady) {
    heldNavigation = { op, path };
    return;
  }
  perform(op, path);
}

export function navigateTo(path: string): void {
  request('push', path);
}

export function replaceWith(path: string): void {
  request('replace', path);
}

export function dismissTo(path: string): void {
  request('dismissTo', path);
}

export function goBack(fallback: string): void {
  if (!navigationReady) {
    heldNavigation = { op: 'replace', path: fallback };
    return;
  }
  if (router.canGoBack()) {
    router.back();
    return;
  }
  replaceWith(fallback);
}

export function markNavigationReady(): void {
  navigationReady = true;
  const held = heldNavigation;
  heldNavigation = null;
  if (held !== null) {
    perform(held.op, held.path);
  }
}

export function isNavigationReady(): boolean {
  return navigationReady;
}

function isVariantName(value: unknown): value is BrandVariantName {
  return typeof value === 'string' && Object.hasOwn(BRAND.variants, value);
}

// 06b 1.4 "Links to the public pages"; E-WEB-06 to E-WEB-08
export function publicPageUrl(path: '/privacy' | '/terms' | '/content-policy'): string {
  const variant: unknown = Constants.expoConfig?.extra?.variant;
  if (isVariantName(variant) && brandVariant(variant).host !== null) {
    return `${siteOrigin(variant)}${path}`;
  }
  try {
    return `${session.apiOrigin}${path}`;
  } catch {
    return path;
  }
}

/** Restores every module default: the remembered next and tab, the tracked path, readiness and the held navigation. */
export function resetNavigationState(): void {
  rememberedNext = null;
  rememberedTab = null;
  trackedPath = '/';
  navigationReady = false;
  heldNavigation = null;
}
