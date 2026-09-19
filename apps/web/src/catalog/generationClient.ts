import {
  assertValidContract, validatePreparedImport, validateGenerationJob,
  type PrepareRequest, type PreparedImport, type GenerateRequest, type GenerationJob,
} from "@contracts";

/** Same-origin Vite proxy keeps API keys server-side and works with HTTP or HTTPS. */
export function createGenerationClient(fetcher: typeof fetch = fetch) {
  async function request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`/api/v1/models${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Preparation is the expensive Sol call. Never retry it automatically.
        signal: AbortSignal.timeout(body && path === "/prepare" ? 660_000 : 30_000),
      });
    } catch {
      throw new Error("Generation backend unavailable or request timed out. Check that the API is running on port 8000. A timed-out analysis may still be running; retrying can incur another charge.");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.detail;
      throw new Error(typeof detail === "string" ? detail : Array.isArray(detail)
        ? detail.map((e: { msg: string }) => e.msg).join("; ")
        : "Generation backend unavailable. Start the API on port 8000 and try again.");
    }
    return data;
  }
  function parseJob(data: unknown): GenerationJob {
    assertValidContract("GenerationJob", validateGenerationJob, data);
    if (data.asset && !/^\/api\/v1\/models\/assets\/[a-f0-9]{64}\.glb$/.test(data.asset.glbUrl)) {
      throw new Error("Generation returned an unexpected model URL.");
    }
    return data;
  }
  return {
    async prepare(input: PrepareRequest): Promise<PreparedImport> {
      const data = await request("/prepare", input);
      assertValidContract("PreparedImport", validatePreparedImport, data);
      return data;
    },
    async generate(input: GenerateRequest) { return parseJob(await request("/generate", input)); },
    async job(id: string) { return parseJob(await request(`/jobs/${encodeURIComponent(id)}`)); },
  };
}

export async function waitForGeneration(
  first: GenerationJob,
  client: Pick<ReturnType<typeof createGenerationClient>, "job">,
  onProgress: (job: GenerationJob) => void,
  pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<GenerationJob> {
  let job = first;
  for (let polls = 0; polls <= 160; polls++) {
    onProgress(job);
    if (job.status === "failed") throw new Error(job.error || "Blender could not build this model.");
    if (job.status === "ready") {
      if (!job.asset) throw new Error("The completed job did not return a model.");
      return job;
    }
    if (polls === 160) break;
    await pause(1000);
    job = await client.job(job.jobId);
  }
  throw new Error("The build is still running. Use Resume to check the same job without paying for another analysis.");
}

export function furnitureImageDataUrl(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 5_000_000) {
    return Promise.reject(new Error("Choose a JPEG, PNG or WebP product image under 5 MB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
