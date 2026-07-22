export const USDC_DECIMALS = 6n;

export function parseUsdc(value: string): bigint {
  if (!/^-?(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) {
    throw new Error("USDC amount must be a decimal string with at most 6 fractional digits");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const units = `${whole}${fraction.padEnd(Number(USDC_DECIMALS), "0")}`;
  const parsed = BigInt(units);
  return negative ? -parsed : parsed;
}

export function formatUsdc(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const raw = absolute.toString().padStart(7, "0");
  const whole = raw.slice(0, -6);
  const fraction = raw.slice(-6).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function retainedUnits(gross: bigint, cost: bigint): bigint {
  return gross > cost ? gross - cost : 0n;
}
