import { useEffect, useState } from "react";
import { checkApiHealth, type ApiHealthPayload } from "./checkApiHealth";

const HEALTH_TIMEOUT_MS = 3_000;

export type ApiHealthState =
  | { status: "checking" }
  | { status: "connected"; payload: ApiHealthPayload }
  | { status: "unavailable"; message: string };

export function useApiHealth(): ApiHealthState {
  const [health, setHealth] = useState<ApiHealthState>({
    status: "checking",
  });

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    const timeout = window.setTimeout(
      () => controller.abort(),
      HEALTH_TIMEOUT_MS,
    );

    void checkApiHealth(controller.signal)
      .then((payload) => {
        if (isActive) {
          setHealth({ status: "connected", payload });
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          setHealth({ status: "unavailable", message });
        }
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      isActive = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return health;
}
