import { describe, expect, it } from 'vitest';
import { createS3Client } from './client.ts';

const CONFIG = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  accessKeyId: 'fixture-access-key',
  secretAccessKey: 'fixture-secret-key',
};

describe('createS3Client', () => {
  it('builds a client with the checksum settings of D-248', async () => {
    for (const forcePathStyle of [true, false]) {
      const client = createS3Client({ ...CONFIG, forcePathStyle });
      expect(await client.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED');
      expect(await client.config.responseChecksumValidation()).toBe('WHEN_REQUIRED');
      expect(client.config.forcePathStyle).toBe(forcePathStyle);
      expect(await client.config.region()).toBe('us-east-1');
    }
  });
});
