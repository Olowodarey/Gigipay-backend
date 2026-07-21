import { type Address } from 'viem';

// ─── Shared payment-token registry ───────────────────────────────────────────
// Single source of truth for agent-facing + scheduler-facing token addresses.
// MiniPay token scope: USDC / USDT / USDm (cUSD) only + native for gas-free UX.
// Stablecoins are treated as ~$1. Keep addresses here ONLY — don't re-declare
// them per feature (that drift is what caused the earlier address mismatch).

export interface PaymentToken {
  symbol: string;
  address: Address;
  decimals: number;
  isNative: boolean;
  isStable: boolean;
}

export const NATIVE: Address = '0x0000000000000000000000000000000000000000';

export const TOKENS: Record<number, PaymentToken[]> = {
  // Celo mainnet
  42220: [
    { symbol: 'CELO', address: NATIVE, decimals: 18, isNative: true, isStable: false },
    { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6, isNative: false, isStable: true },
    { symbol: 'USDT', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6, isNative: false, isStable: true },
    { symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18, isNative: false, isStable: true }, // cUSD
  ],
  // Base mainnet
  8453: [
    { symbol: 'ETH', address: NATIVE, decimals: 18, isNative: true, isStable: false },
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, isNative: false, isStable: true },
  ],
  // Celo Sepolia (testnet) — native only until stablecoin addresses are added
  11142220: [
    { symbol: 'CELO', address: NATIVE, decimals: 18, isNative: true, isStable: false },
  ],
};

// Nigerian mobile network → ClubKonnect/Nellobytesystems code
export const NETWORK_CODES: Record<string, string> = {
  MTN: '01',
  GLO: '02',
  '9MOBILE': '03',
  ETISALAT: '03',
  AIRTEL: '04',
};

/** Resolve a token by symbol on a chain, or throw a user-friendly error. */
export function resolveToken(chainId: number, symbol: string): PaymentToken {
  const list = TOKENS[chainId] ?? [];
  const token = list.find(
    (t) => t.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  if (!token) {
    const available = list.map((t) => t.symbol).join(', ') || 'none';
    throw new Error(
      `Token "${symbol}" is not available on this chain. Available: ${available}.`,
    );
  }
  return token;
}
