import { createRailwayContext, project } from 'railway/iac';
import { describe, expect, it } from 'vitest';
import program from '../.railway/railway.ts';

const REGION = 'us-east4-eqdc4a';
const SERVICES = ['postgres', 'api', 'worker', 'backup', 'admin'] as const;

type Node = {
  type: string;
  name: string;
  replicas?: unknown;
  deploy?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  config?: Record<string, unknown>;
  networking?: { customDomains?: Record<string, unknown> };
  volumeAttachments?: Record<string, { volumeConfig?: Record<string, unknown> }>;
};

// The staging graph: production's host is null in brand.json until the owner gives the domain,
// and the file throws for it on purpose.
async function stagingNodes(): Promise<Node[]> {
  const definition = await program(createRailwayContext({ environment: 'staging' }), project);
  return definition.resources as unknown as Node[]; // the SDK's resource union, read as plain data
}

function serviceNode(nodes: readonly Node[], name: string): Node {
  const node = nodes.find((item) => item.type === 'service' && item.name === name);
  if (node === undefined) throw new Error(`no service ${name}`);
  return node;
}

describe('.railway/railway.ts', () => {
  it('declares each service region as the key of its replica count, never as deploy.region', async () => {
    const nodes = await stagingNodes();
    expect(nodes.filter((item) => item.type === 'service').map((item) => item.name)).toEqual([
      ...SERVICES,
    ]);
    for (const name of SERVICES) {
      const deploy = serviceNode(nodes, name).deploy ?? {};
      expect(deploy, name).not.toHaveProperty('region');
      expect(deploy.multiRegionConfig, name).toEqual({ [REGION]: { numReplicas: 1 } });
    }
  });

  it('keeps the volume and bucket regions', async () => {
    const nodes = await stagingNodes();
    const postgres = serviceNode(nodes, 'postgres');
    expect(postgres.volumeAttachments?.pgdata?.volumeConfig).toEqual({
      region: REGION,
      sizeMB: 50000,
    });
    const buckets = nodes.filter((item) => item.type === 'bucket');
    expect(buckets.map((item) => item.name)).toEqual(['media', 'data', 'backups']);
    for (const bucket of buckets) {
      expect(bucket.config, bucket.name).toEqual({ region: 'iad' });
    }
  });

  it('names x-real-ip as the client address header on api and admin only', async () => {
    const nodes = await stagingNodes();
    for (const name of SERVICES) {
      const variable = serviceNode(nodes, name).variables?.CLIENT_IP_HEADER;
      if (name === 'api' || name === 'admin') {
        expect(variable, name).toEqual({ type: 'literal', value: 'x-real-ip' });
      } else {
        expect(variable, name).toBeUndefined();
      }
    }
  });

  // 09 section 1.3: the five media references on api, worker and admin; the worker's environment
  // check refuses to start without them.
  it('gives api, worker and admin the five media bucket references, and backup none', async () => {
    const nodes = await stagingNodes();
    const media = [
      'MEDIA_ACCESS_KEY_ID',
      'MEDIA_BUCKET',
      'MEDIA_ENDPOINT',
      'MEDIA_REGION',
      'MEDIA_SECRET_ACCESS_KEY',
    ];
    for (const name of SERVICES) {
      const declared = Object.keys(serviceNode(nodes, name).variables ?? {}).filter((key) =>
        key.startsWith('MEDIA_'),
      );
      if (name === 'api' || name === 'worker' || name === 'admin') {
        expect(declared.sort(), name).toEqual(media);
      } else {
        expect(declared, name).toEqual([]);
      }
    }
  });

  // `config apply` refuses a custom domain it has not seen; the bootstrap adds them (D-849).
  it('declares no custom domain on any service', async () => {
    const nodes = await stagingNodes();
    for (const node of nodes.filter((item) => item.type === 'service')) {
      expect(node.networking?.customDomains, node.name).toBeUndefined();
      expect(node, node.name).not.toHaveProperty('domains');
    }
  });
});
