import { rewriteSystemPath } from '@/lib/native-intent';

// PM-auth: Apple's Android return reaches the router as a deep link; runs on cold and warm starts.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return rewriteSystemPath(path);
}
