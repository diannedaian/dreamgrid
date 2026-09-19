import { appConfig } from "../../lib/config";
import { useApiHealth } from "../../lib/health/useApiHealth";

const labels = {
  checking: "Checking API",
  connected: "API connected",
  unavailable: "API unavailable",
} as const;

export function ApiStatus() {
  const health = useApiHealth();

  return (
    <div
      className={`api-status api-status--${health.status}`}
      role="status"
      title={
        health.status === "unavailable"
          ? `${health.message} (${appConfig.apiBaseUrl})`
          : `Backend: ${appConfig.apiBaseUrl}`
      }
    >
      <span className="api-status__dot" aria-hidden="true" />
      <span>{labels[health.status]}</span>
    </div>
  );
}
