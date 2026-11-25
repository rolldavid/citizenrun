// PM-links, D-536: the check for a URL the API issued in the response being handled.

const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/** True for a URL the API issued that the app may open: https, or http on localhost or 127.0.0.1. No length limit. */
export function isIssuedUrlAllowed(url: string): boolean {
  let protocol: string;
  let hostname: string;
  try {
    const parsed = new URL(url);
    // React Native's URL keeps the case it was given; the browser's lowers both
    protocol = parsed.protocol.toLowerCase();
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (protocol === 'https:') {
    return true;
  }
  return protocol === 'http:' && LOCAL_HOSTS.includes(hostname);
}
