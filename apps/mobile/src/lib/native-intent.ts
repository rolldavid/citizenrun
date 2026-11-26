const SIGN_IN_PATH = '/sign-in';

function namesAppleReturn(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

function pathOnly(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

function isAppleReturn(path: string): boolean {
  if (path.startsWith('/')) {
    return namesAppleReturn(pathOnly(path), '/auth/apple');
  }
  try {
    const url = new URL(path);
    if (url.host === 'auth') {
      return namesAppleReturn(url.pathname, '/apple');
    }
    return url.host === '' && namesAppleReturn(url.pathname, '/auth/apple');
  } catch {
    return false;
  }
}

/** Sends the Apple return path to the sign-in screen; every other path is returned unchanged. */
export function rewriteSystemPath(path: string): string {
  try {
    return isAppleReturn(path) ? SIGN_IN_PATH : path;
  } catch {
    return path;
  }
}
