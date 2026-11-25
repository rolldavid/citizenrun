import { EventEmitter } from 'node:events';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { readDatabaseFacts } from './facts.ts';

// A stand-in for pg.Client whose connection ends during the first query: as pg does, the client
// emits 'error' from a socket callback and the query in flight then rejects.
class CutClient extends EventEmitter {
  ended = false;

  connect(): Promise<void> {
    return Promise.resolve();
  }

  query(): Promise<never> {
    return new Promise<never>((_resolve, reject) => {
      setImmediate(() => {
        this.emit('error', new Error('Connection terminated unexpectedly'));
        setImmediate(() => {
          reject(new Error('Connection terminated unexpectedly'));
        });
      });
    });
  }

  end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }
}

describe('readDatabaseFacts', () => {
  it('a connection cut during a query rejects the read and crashes nothing', async () => {
    const client = new CutClient();
    // test double: implements the four members readDatabaseFacts uses
    const facts = readDatabaseFacts(
      'postgresql://fixture.invalid/fixture',
      () => client as unknown as pg.Client,
    );
    await expect(facts).rejects.toThrow('Connection terminated unexpectedly');
    expect(client.ended).toBe(true);
  });
});
