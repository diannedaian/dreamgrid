import {
  assertValidContract, validateGenerateRequest, validateGenerationJob,
  validatePreparedImport, validatePrepareRequest,
  type GenerateRequest, type GenerationJob, type PreparedImport, type PrepareRequest,
} from '@dreamgrid/contracts';

import { appConfig, type AppConfig } from '../config';

/** Integration-only helper. Cindy owns the review panel and scene updates. */
export function createModelGenerationClient(config: AppConfig = appConfig, fetcher = fetch) {
  async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetcher(config.apiUrl(`/api/v1/models${path}`), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const detail = typeof data === 'object' && data !== null && 'detail' in data
        ? (data as { detail: unknown }).detail : null;
      throw new Error(typeof detail === 'string' ? detail : `Model request failed (${response.status}).`);
    }
    return data;
  }

  function modelJob(data: unknown): GenerationJob {
    assertValidContract('GenerationJob', validateGenerationJob, data);
    return {
      ...data,
      // Relative asset routes belong to the BACKEND, not the Vite frontend.
      asset: data.asset ? { ...data.asset, glbUrl: config.apiUrl(data.asset.glbUrl) } : null,
    };
  }

  return {
    async prepare(input: PrepareRequest, signal?: AbortSignal): Promise<PreparedImport> {
      assertValidContract('PrepareRequest', validatePrepareRequest, input);
      const data = await request('/prepare', input, signal);
      assertValidContract('PreparedImport', validatePreparedImport, data);
      return data;
    },
    async generate(input: GenerateRequest, signal?: AbortSignal): Promise<GenerationJob> {
      assertValidContract('GenerateRequest', validateGenerateRequest, input);
      return modelJob(await request('/generate', input, signal));
    },
    async job(jobId: string, signal?: AbortSignal): Promise<GenerationJob> {
      return modelJob(await request(`/jobs/${encodeURIComponent(jobId)}`, undefined, signal));
    },
  };
}

export function measurementToMeters(value: number, unit: 'in' | 'cm' | 'm'): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Enter a positive measurement.');
  return value * (unit === 'in' ? 0.0254 : unit === 'cm' ? 0.01 : 1);
}

export async function furnitureImageDataUrl(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5_000_000) {
    throw new Error('Choose a JPEG, PNG, or WebP image under 5 MB.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
