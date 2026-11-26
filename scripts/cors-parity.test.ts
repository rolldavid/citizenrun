import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mediaCorsRules } from './lib/cors.ts';
import { repoRoot } from './lib/repo-root.ts';

describe('media bucket CORS', () => {
  it('local CORS equals mediaCorsRules', () => {
    const local: unknown = JSON.parse(
      readFileSync(join(repoRoot(), 'docker/seaweedfs/cors.json'), 'utf8'),
    );
    expect(local).toStrictEqual(
      mediaCorsRules([
        'http://localhost:8081',
        'http://localhost:8080',
        'http://localhost:8070',
        'http://localhost:8071',
      ]),
    );
  });

  it('keeps the origins in the order given and copies them', () => {
    const origins = ['https://b.example.test', 'https://a.example.test'];
    const rules = mediaCorsRules(origins);
    expect(rules.CORSRules).toHaveLength(1);
    expect(rules.CORSRules[0]?.AllowedOrigins).toEqual(origins);
    expect(rules.CORSRules[0]?.AllowedOrigins).not.toBe(origins);
  });
});
