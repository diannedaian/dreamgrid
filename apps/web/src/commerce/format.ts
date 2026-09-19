const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatUsd(value: number): string {
  return usd.format(value);
}

/** "-$19" reads better than "$-19" for over-budget amounts. */
export function formatSignedUsd(value: number): string {
  return value < 0 ? `-${usd.format(-value)}` : usd.format(value);
}
