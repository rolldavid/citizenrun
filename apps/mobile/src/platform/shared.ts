/** The fifteen module names, in the form used in error codes' first segment. */
export type PlatformModuleName =
  | 'session'
  | 'map'
  | 'upload'
  | 'push'
  | 'share'
  | 'location'
  | 'haptics'
  | 'calendar'
  | 'auth'
  | 'pdf'
  | 'video'
  | 'storage'
  | 'links'
  | 'age_assurance'
  | 'query_client';

/**
 * A permission as the caller must treat it.
 * - granted: the capability may be used now.
 * - limited: granted with less than asked: iOS reduced location accuracy or Android approximate location.
 * - undetermined: never asked; asking shows the system prompt.
 * - denied: refused, and asking again shows the system prompt again (Android before "Don't ask again").
 * - blocked: refused, and the system will not prompt again; only the system settings can change it.
 * - unsupported: this platform has no such permission or no such capability.
 */
export type PermissionState =
  'granted' | 'limited' | 'undetermined' | 'denied' | 'blocked' | 'unsupported';

/** Removes a listener. Calling it twice does nothing. */
export type Unsubscribe = () => void;

/**
 * An unexpected failure inside a module. `code` is a static code (`<module>.<reason>`, matching
 * /^[a-z][a-z0-9_.]{0,63}$/, the pattern of E-SAFE-02's `code`), so the client error reporter can send it
 * with nothing else. Expected outcomes (cancelled, denied, unsupported) are return values, never errors.
 */
export class PlatformError extends Error {
  override readonly name: string = 'PlatformError';
  readonly module: PlatformModuleName;
  readonly code: string;
  constructor(module: PlatformModuleName, code: string) {
    super(code); // the message is the static code; never a value
    this.module = module;
    this.code = code;
  }
}

/** Thrown or rejected by a member whose element is not built yet. */
export class PlatformNotReadyError extends PlatformError {
  override readonly name: string = 'PlatformNotReadyError';
  readonly method: string;
  constructor(module: PlatformModuleName, method: string) {
    super(module, `${module}.not_ready`);
    this.method = method;
  }
}

/** Maps an Expo permission response to PermissionState. Shared by every native module that asks one. */
export function fromExpoPermission(
  res: {
    status: 'granted' | 'denied' | 'undetermined';
    canAskAgain: boolean;
  },
  limited: boolean,
): PermissionState {
  if (res.status === 'granted') return limited ? 'limited' : 'granted';
  if (res.status === 'undetermined') return 'undetermined';
  return res.canAskAgain ? 'denied' : 'blocked';
}
