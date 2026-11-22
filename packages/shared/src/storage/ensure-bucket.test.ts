import { describe, expect, it } from 'vitest';
import { createS3Client } from './client.ts';
import { ensureBucket } from './ensure-bucket.ts';

type Answer = { error: { name: string; status?: number } } | { ok: true };

// A real client whose requests stop at the first middleware step: each command is recorded with its
// input and answered from `answers`, so nothing reaches the network.
function scriptedClient(answers: Readonly<Record<string, Answer>>) {
  const sent: { command: string; input: unknown }[] = [];
  const client = createS3Client({
    endpoint: 'http://127.0.0.1:9',
    region: 'us-east-1',
    accessKeyId: 'fixture-access-key',
    secretAccessKey: 'fixture-secret-key',
    forcePathStyle: true,
  });
  client.middlewareStack.add(
    (_next, context) => (args) => {
      const command = String(context.commandName);
      sent.push({ command, input: args.input });
      const answer = answers[command] ?? { ok: true };
      if ('error' in answer) {
        return Promise.reject(
          Object.assign(new Error('fixture failure'), {
            name: answer.error.name,
            $metadata: { httpStatusCode: answer.error.status },
          }),
        );
      }
      return Promise.resolve({ output: { $metadata: {} }, response: {} });
    },
    { step: 'initialize', name: 'scriptedAnswers' },
  );
  return { client, sent };
}

describe('ensureBucket', () => {
  it('creates a bucket that does not exist', async () => {
    const { client, sent } = scriptedClient({
      HeadBucketCommand: { error: { name: 'NotFound', status: 404 } },
    });
    await ensureBucket(client, 'media');
    expect(sent).toEqual([
      { command: 'HeadBucketCommand', input: { Bucket: 'media' } },
      { command: 'CreateBucketCommand', input: { Bucket: 'media' } },
    ]);
  });

  it('treats a bare 404 as missing', async () => {
    const { client, sent } = scriptedClient({
      HeadBucketCommand: { error: { name: 'Unknown', status: 404 } },
    });
    await ensureBucket(client, 'media');
    expect(sent.map((entry) => entry.command)).toEqual([
      'HeadBucketCommand',
      'CreateBucketCommand',
    ]);
  });

  it('leaves an existing bucket alone', async () => {
    const { client, sent } = scriptedClient({});
    await ensureBucket(client, 'media');
    expect(sent.map((entry) => entry.command)).toEqual(['HeadBucketCommand']);
  });

  it('ignores a bucket created by someone else in between', async () => {
    const { client } = scriptedClient({
      HeadBucketCommand: { error: { name: 'NotFound', status: 404 } },
      CreateBucketCommand: { error: { name: 'BucketAlreadyOwnedByYou', status: 409 } },
    });
    await expect(ensureBucket(client, 'media')).resolves.toBeUndefined();
  });

  it('rethrows any other failure', async () => {
    const { client, sent } = scriptedClient({
      HeadBucketCommand: { error: { name: 'Forbidden', status: 403 } },
    });
    await expect(ensureBucket(client, 'media')).rejects.toMatchObject({ name: 'Forbidden' });
    expect(sent.map((entry) => entry.command)).toEqual(['HeadBucketCommand']);
  });

  it('applies the CORS rules when given', async () => {
    const { client, sent } = scriptedClient({});
    const rules = [{ AllowedMethods: ['GET', 'POST'], AllowedOrigins: ['http://localhost:8081'] }];
    await ensureBucket(client, 'media', { cors: { CORSRules: rules } });
    expect(sent).toEqual([
      { command: 'HeadBucketCommand', input: { Bucket: 'media' } },
      {
        command: 'PutBucketCorsCommand',
        input: { Bucket: 'media', CORSConfiguration: { CORSRules: rules } },
      },
    ]);
  });
});
