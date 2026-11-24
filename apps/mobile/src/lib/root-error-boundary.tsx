import { assertNever } from '@citizenrun/shared';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { links } from '@/platform/links';

import { componentFromStack, isChunkLoadError, reportClientError } from './client-errors';

export type RootErrorFallbackProps = { onRetry: () => void };

export type RootErrorBoundaryProps = {
  /** The current route pattern (routePattern of useSegments()), sent with a report. */
  route: string | null;
  /** What shows after an error the boundary cannot clear. */
  fallback: (props: RootErrorFallbackProps) => ReactNode;
  children: ReactNode;
};

type RootErrorBoundaryState = { phase: 'ok' | 'caught' | 'reloading' | 'failed' };

/** The reload-once boundary (D-163): reports a render error, reloads the web page once on a chunk-load error,
 *  and otherwise shows the fallback. */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  override state: RootErrorBoundaryState = { phase: 'ok' };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { phase: 'caught' };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The report goes first: it is sent with keepalive, so a reload does not cancel it.
    reportClientError(
      error,
      { route: this.props.route, component: componentFromStack(info.componentStack) },
      'app.render_failed',
    );
    if (isChunkLoadError(error) && links.reloadOnce('chunk_error')) {
      this.setState({ phase: 'reloading' });
      return;
    }
    this.setState({ phase: 'failed' });
  }

  private readonly retry = (): void => {
    this.setState({ phase: 'ok' });
  };

  override render(): ReactNode {
    switch (this.state.phase) {
      case 'ok':
        return this.props.children;
      case 'caught':
      case 'reloading':
        return null;
      case 'failed':
        return this.props.fallback({ onRetry: this.retry });
      default:
        return assertNever(this.state.phase);
    }
  }
}
