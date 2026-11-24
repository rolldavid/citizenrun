import { describe, expect, it } from 'vitest';

import { MAP_SPIKE_PORT, spikeServerOrigin } from './spike-server';

describe('spikeServerOrigin', () => {
  it('serves the spike host on port 8091', () => {
    expect(MAP_SPIKE_PORT).toBe(8091);
  });

  it('the web uses localhost', () => {
    expect(spikeServerOrigin('', null)).toBe('http://localhost:8091');
  });

  it('a phone uses the API host', () => {
    expect(spikeServerOrigin('http://192.168.1.5:8080', null)).toBe('http://192.168.1.5:8091');
  });

  it('a host with no port and a trailing slash', () => {
    expect(spikeServerOrigin('https://staging.example.test/', null)).toBe(
      'https://staging.example.test:8091',
    );
  });

  it('the emulator host', () => {
    expect(spikeServerOrigin('http://10.0.2.2:8080', null)).toBe('http://10.0.2.2:8091');
  });

  it('a valid override wins', () => {
    expect(spikeServerOrigin('http://192.168.1.5:8080', 'http://localhost:8091')).toBe(
      'http://localhost:8091',
    );
  });

  it('an invalid override is ignored', () => {
    expect(spikeServerOrigin('', 'javascript:alert(1)')).toBe('http://localhost:8091');
    expect(spikeServerOrigin('', 'http://a b')).toBe('http://localhost:8091');
  });

  it('an invalid override falls through to the API host', () => {
    expect(spikeServerOrigin('http://10.0.2.2:8080', 'http://a b')).toBe('http://10.0.2.2:8091');
  });

  it('anything else falls back', () => {
    expect(spikeServerOrigin('not an origin', null)).toBe('http://localhost:8091');
  });

  it('an origin with a path falls back', () => {
    expect(spikeServerOrigin('http://192.168.1.5:8080/v1', null)).toBe('http://localhost:8091');
  });
});
