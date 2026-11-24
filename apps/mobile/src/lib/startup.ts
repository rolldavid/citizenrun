import { useEffect, useSyncExternalStore } from 'react';

import { links } from '@/platform/links';
import { queryClient } from '@/platform/query-client';
import { session } from '@/platform/session';
import type { SessionCallbacks } from '@/platform/session';
import { storage } from '@/platform/storage';

import { reportClientError } from './client-errors';

export type StartupState = { booted: boolean; updateRequired: boolean };

type Listener = () => void;

let state: StartupState = { booted: false, updateRequired: false };
const listeners = new Set<Listener>();
let started: Promise<void> | null = null;

function setState(patch: Partial<StartupState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) {
    listener();
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): StartupState {
  return state;
}

/** Runs PM-structure's startup order: storage, then the session, then the query client. */
export async function startPlatform(callbacks: SessionCallbacks): Promise<void> {
  await storage.hydrate();
  session.configure(callbacks);
  queryClient.get();
  queryClient.start();
}

/** 426: reloads the web page once; calls onBlocked when no reload is possible (phones, or the second time). */
export function handleUpgradeRequired(onBlocked: () => void): void {
  if (!links.reloadOnce('upgrade_required')) onBlocked();
}

const callbacks: SessionCallbacks = {
  // No session exists before PM-session-tokens, which brings the session end.
  onUnauthorized: () => undefined,
  onUpgradeRequired: () => {
    handleUpgradeRequired(() => {
      setState({ updateRequired: true });
    });
  },
};

function start(): Promise<void> {
  return startPlatform(callbacks).then(
    () => {
      setState({ booted: true });
    },
    (error: unknown) => {
      // The app still renders, so its requests fail visibly instead of leaving a blank screen.
      reportClientError(error, { route: null, component: null }, 'app.startup_failed');
      setState({ booted: true });
    },
  );
}

/** Starts the platform once per process and reports when the app may render. */
export function useStartup(): StartupState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    started ??= start();
  }, []);
  return snapshot;
}
