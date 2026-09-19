import { appConfig, type AppConfig } from "../config";

export type ApiHealthPayload = {
  status: string;
  service?: string;
  version?: string;
};

function isHealthPayload(value: unknown): value is ApiHealthPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "string"
  );
}

export async function checkApiHealth(
  signal?: AbortSignal,
  config: AppConfig = appConfig,
): Promise<ApiHealthPayload> {
  const response = await fetch(config.apiUrl("/api/v1/health"), {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (!isHealthPayload(payload)) {
    throw new Error("Health check returned an invalid response.");
  }

  return payload;
}
