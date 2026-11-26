import { PlatformError } from '@/platform/shared';

const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';
const URL_SCHEME_PREFIX = 'com.googleusercontent.apps.';

/** The iOS URL scheme the library's config plugin needs: the reversed iOS client id. */
export function iosUrlSchemeFor(iosClientId: string): string {
  const parts = iosClientId.split(CLIENT_ID_SUFFIX);
  const [head, tail] = parts;
  if (parts.length !== 2 || head === undefined || head === '' || tail !== '') {
    throw new PlatformError('auth', 'auth.not_configured');
  }
  return URL_SCHEME_PREFIX + head;
}
