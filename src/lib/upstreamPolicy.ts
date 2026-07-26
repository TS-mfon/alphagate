import { BASE_USDC, PROVIDER_COSTS, PROVIDER_PAYEES } from "./pricing";

export type ProviderName = keyof typeof PROVIDER_COSTS;

interface PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  extra?: {
    assetTransferMethod?: string;
    [key: string]: unknown;
  };
}

export function approvedPaymentRequirements<T extends PaymentRequirement>(
  provider: ProviderName,
  requirements: T[]
) {
  const expectedAmount = PROVIDER_COSTS[provider].toString();
  const expectedPayee = PROVIDER_PAYEES[provider].toLowerCase();

  return requirements.filter(requirement =>
    requirement.scheme === "exact"
    && requirement.network === "eip155:8453"
    && requirement.amount === expectedAmount
    && requirement.asset.toLowerCase() === BASE_USDC.toLowerCase()
    && requirement.payTo.toLowerCase() === expectedPayee
    && (
      requirement.extra?.assetTransferMethod === undefined
      || requirement.extra.assetTransferMethod === "eip3009"
    )
  );
}
