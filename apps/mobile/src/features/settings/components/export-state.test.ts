import type { DataExportStatus, DataExportView } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { exportState } from './export-state';

const NOW = new Date('2027-01-15T13:00:00.000Z');
const LATER = '2027-01-16T12:00:00.000Z';
const EARLIER = '2027-01-15T12:30:00.000Z';

function exportOf(
  status: DataExportView['status'],
  over: Partial<DataExportView> = {},
): DataExportView {
  return {
    id: '01890000-0000-7000-8000-0000000000e1',
    status,
    requestedAt: '2027-01-15T12:00:00.000Z',
    readyAt: null,
    expiresAt: null,
    ...over,
  };
}

function stateOf(last: DataExportView | null, nextRequestAt: string | null): unknown {
  const status: DataExportStatus = { export: last, nextRequestAt };
  return exportState(status, NOW);
}

describe('exportState', () => {
  it('order of the rules', () => {
    // A file being built comes before the wait for the next request.
    expect(stateOf(exportOf('queued'), LATER)).toEqual({ kind: 'queued' });
    expect(stateOf(exportOf('queued'), null)).toEqual({ kind: 'queued' });

    // So does a file that is ready, which is kept until it expires.
    expect(
      stateOf(
        exportOf('ready', {
          readyAt: '2027-01-15T12:04:00.000Z',
          expiresAt: '2027-01-16T12:04:00.000Z',
        }),
        LATER,
      ),
    ).toEqual({ kind: 'ready', until: '2027-01-16T12:04:00.000Z' });

    // Then the wait, whatever became of the last file.
    expect(stateOf(exportOf('failed'), LATER)).toEqual({ kind: 'wait', until: LATER });
    expect(stateOf(exportOf('expired'), LATER)).toEqual({ kind: 'wait', until: LATER });
    expect(stateOf(null, LATER)).toEqual({ kind: 'wait', until: LATER });

    // Then how the last file ended.
    expect(stateOf(exportOf('expired'), null)).toEqual({ kind: 'expired' });
    expect(stateOf(exportOf('failed'), null)).toEqual({ kind: 'failed' });

    // And otherwise nothing.
    expect(stateOf(null, null)).toEqual({ kind: 'none' });
  });

  it('a wait that is over is no wait', () => {
    expect(stateOf(exportOf('failed'), EARLIER)).toEqual({ kind: 'failed' });
    expect(stateOf(exportOf('expired'), EARLIER)).toEqual({ kind: 'expired' });
    expect(stateOf(null, EARLIER)).toEqual({ kind: 'none' });
    // The instant itself is not later than now.
    expect(stateOf(null, NOW.toISOString())).toEqual({ kind: 'none' });
  });

  it('a ready file without an expiry reads the latest instant it has', () => {
    expect(stateOf(exportOf('ready', { readyAt: '2027-01-15T12:04:00.000Z' }), null)).toEqual({
      kind: 'ready',
      until: '2027-01-15T12:04:00.000Z',
    });
    expect(stateOf(exportOf('ready'), null)).toEqual({
      kind: 'ready',
      until: '2027-01-15T12:00:00.000Z',
    });
  });
});
