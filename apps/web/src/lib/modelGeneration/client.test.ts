import { describe, expect, it, vi } from 'vitest';
import { createAppConfig } from '../config';
import { createModelGenerationClient, measurementToMeters } from './client';

const review = Object.fromEntries(['width', 'height', 'depth'].map(axis => [
  axis, { valueM: 1, source: 'estimated', evidence: 'Example size' },
]));

describe('model pipeline handoff client', () => {
  it('converts inches and centimeters only at the UI boundary', () => {
    expect(measurementToMeters(42, 'in')).toBeCloseTo(1.0668);
    expect(measurementToMeters(60, 'cm')).toBe(.6);
    expect(() => measurementToMeters(NaN, 'm')).toThrow();
  });

  it('resolves returned assets against the API origin, not the frontend', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: 'job', status: 'ready', error: null, cached: false, dimensions: review,
      asset: {
        id: 'asset', productId: 'product', glbUrl: '/api/v1/models/assets/abc.glb',
        dimensionsM: [1, 1, 1], pivot: 'bottom-center', forwardAxis: '+Z',
        generationMethod: 'gpt-blender', status: 'ready', disclosure: 'Approximate.',
      },
    })));
    const client = createModelGenerationClient(createAppConfig({ VITE_API_BASE_URL: 'http://localhost:8000' }), fetcher);
    const job = await client.job('job');
    expect(job.asset?.glbUrl).toBe('http://localhost:8000/api/v1/models/assets/abc.glb');
  });

  it('surfaces actionable API errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Import expired' }), { status: 404 }));
    const client = createModelGenerationClient(createAppConfig({}), fetcher);
    await expect(client.job('old')).rejects.toThrow('Import expired');
  });
});
