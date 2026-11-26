import type { DataExportStatus } from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';

import {
  EXPORT_POLL_MS,
  exportDownload,
  exportPollInterval,
  requestExport,
} from './export-requests';

const QUEUED = {
  id: '01890000-0000-7000-8000-0000000000e1',
  status: 'queued',
  requestedAt: '2027-01-15T12:00:00.000Z',
  readyAt: null,
  expiresAt: null,
} as const;

function statusWith(exportStatus: 'queued' | 'ready' | 'failed' | 'expired'): DataExportStatus {
  return {
    export: { ...QUEUED, status: exportStatus },
    nextRequestAt: '2027-01-16T12:00:00.000Z',
  };
}

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([
    { method: 'POST', path: '/v1/me/export', reply: json(202, QUEUED) },
    {
      method: 'GET',
      path: '/v1/me/export/download',
      reply: json(200, {
        url: 'https://store.example.test/export.json?signature=fixture',
        expiresAt: '2027-01-15T12:05:00.000Z',
      }),
    },
  ]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('export requests', () => {
  it('requests an export with an empty body', async () => {
    const outcome = await requestExport();
    expect(outcome).toEqual({ ok: true, value: QUEUED });
    expect(stub.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'POST', path: '/v1/me/export', body: {} },
    ]);
  });

  it('asks for a download link', async () => {
    const outcome = await exportDownload();
    expect(outcome.ok).toBe(true);
    expect(stub.requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: 'GET', path: '/v1/me/export/download' },
    ]);
  });

  it('polls the status only while queued', () => {
    expect(EXPORT_POLL_MS).toBe(10_000);
    expect(exportPollInterval(statusWith('queued'))).toBe(10_000);
    expect(exportPollInterval(statusWith('ready'))).toBe(false);
    expect(exportPollInterval(statusWith('failed'))).toBe(false);
    expect(exportPollInterval(statusWith('expired'))).toBe(false);
    expect(exportPollInterval({ export: null, nextRequestAt: null })).toBe(false);
    expect(exportPollInterval(undefined)).toBe(false);
  });
});
