const DEFAULT_API_BASE_URL = "http://localhost:8000";

type PublicEnvironment = Record<string, string | boolean | undefined>;

export type AppConfig = {
  apiBaseUrl: string;
  apiUrl: (path: string) => string;
};

function normalizeApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_API_BASE_URL;

  if (candidate.startsWith("/")) {
    return candidate.replace(/\/$/, "") || "/";
  }

  const parsed = new URL(candidate);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("VITE_API_BASE_URL must use http or https.");
  }

  return parsed.href.replace(/\/$/, "");
}

export function createAppConfig(environment: PublicEnvironment): AppConfig {
  const apiBaseUrl = normalizeApiBaseUrl(
    typeof environment.VITE_API_BASE_URL === "string"
      ? environment.VITE_API_BASE_URL
      : undefined,
  );

  return {
    apiBaseUrl,
    apiUrl: (path: string) => {
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return apiBaseUrl === "/"
        ? normalizedPath
        : `${apiBaseUrl}${normalizedPath}`;
    },
  };
}

export const appConfig = createAppConfig(import.meta.env);
