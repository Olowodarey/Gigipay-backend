import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';
import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';

export const CHAIN_COIN_ID: Record<number, string> = {
  42220: 'celo',
  8453: 'ethereum',
};

export interface TokenRate {
  coinId: string;
  ngn: number;
  usd: number;
  updatedAt: number;
  source?: 'chainlink' | 'coingecko';
}

// ─── Chainlink AggregatorV3 minimal ABI ──────────────────────────────────────
const AGGREGATOR_ABI = [
  {
    inputs: [],
    name: 'latestAnswer',
    outputs: [{ internalType: 'int256', name: '', type: 'int256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Chainlink feed addresses on Celo mainnet
const CHAINLINK_FEEDS = {
  CELO_USD: '0x5FB8bFAEBe2dd6dB2AF308D293ea25e607D3A922' as const,
  NGN_USD: '0xB48C3894bb71B2f1653DE76ad1Da92ed2F05B88f' as const,
};

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private cache = new Map<string, { rate: TokenRate; expiresAt: number }>();
  private readonly TTL_MS = 60_000;

  private readonly celoClient = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  // ─── Primary: Chainlink on-chain (Celo only) ─────────────────────────────

  private async fetchFromChainlink(): Promise<{ ngn: number; usd: number }> {
    const [celoUsdRaw, celoUsdDecimals, ngnUsdRaw, ngnUsdDecimals] =
      await Promise.all([
        this.celoClient.readContract({
          address: CHAINLINK_FEEDS.CELO_USD,
          abi: AGGREGATOR_ABI,
          functionName: 'latestAnswer',
        }),
        this.celoClient.readContract({
          address: CHAINLINK_FEEDS.CELO_USD,
          abi: AGGREGATOR_ABI,
          functionName: 'decimals',
        }),
        this.celoClient.readContract({
          address: CHAINLINK_FEEDS.NGN_USD,
          abi: AGGREGATOR_ABI,
          functionName: 'latestAnswer',
        }),
        this.celoClient.readContract({
          address: CHAINLINK_FEEDS.NGN_USD,
          abi: AGGREGATOR_ABI,
          functionName: 'decimals',
        }),
      ]);

    const celoUsd = Number(celoUsdRaw) / 10 ** celoUsdDecimals;
    const ngnUsd = Number(ngnUsdRaw) / 10 ** ngnUsdDecimals;

    if (celoUsd <= 0 || ngnUsd <= 0) throw new Error('Invalid Chainlink data');

    // CELO/NGN = (CELO/USD) / (NGN/USD)
    const celoNgn = celoUsd / ngnUsd;

    this.logger.log(
      `Chainlink: CELO=$${celoUsd.toFixed(6)} | NGN/USD=${ngnUsd.toFixed(8)} | CELO/NGN=₦${celoNgn.toFixed(4)}`,
    );

    return { usd: celoUsd, ngn: celoNgn };
  }

  // ─── Fallback: CoinGecko HTTP ─────────────────────────────────────────────

  private async fetchFromCoinGecko(
    coinIds: string,
  ): Promise<Record<string, { ngn: number; usd: number }>> {
    const apiKey = this.config.get<string>('coingecko.apiKey');
    const baseUrl = apiKey
      ? 'https://pro-api.coingecko.com/api/v3/simple/price'
      : 'https://api.coingecko.com/api/v3/simple/price';

    const headers: Record<string, string> = {};
    if (apiKey) headers['x-cg-pro-api-key'] = apiKey;

    const { data } = await firstValueFrom(
      this.http
        .get<Record<string, { ngn: number; usd: number }>>(baseUrl, {
          params: { ids: coinIds, vs_currencies: 'ngn,usd' },
          headers,
        })
        .pipe(timeout(8000)),
    );

    return data;
  }

  // ─── Public methods ───────────────────────────────────────────────────────

  async getRate(coinId: string): Promise<TokenRate> {
    const cached = this.cache.get(coinId);
    if (cached && Date.now() < cached.expiresAt) return cached.rate;

    // Primary: Chainlink (only for CELO on Celo chain)
    if (coinId === 'celo') {
      try {
        const { usd, ngn } = await this.fetchFromChainlink();
        const rate: TokenRate = {
          coinId,
          ngn,
          usd,
          updatedAt: Date.now(),
          source: 'chainlink',
        };
        this.cache.set(coinId, { rate, expiresAt: Date.now() + this.TTL_MS });
        return rate;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Chainlink failed, falling back to CoinGecko: ${msg}`);
      }
    }

    // Fallback: CoinGecko
    try {
      const data = await this.fetchFromCoinGecko(coinId);
      const coin = data[coinId];
      if (!coin) throw new Error(`CoinGecko returned no data for ${coinId}`);

      const rate: TokenRate = {
        coinId,
        ngn: coin.ngn,
        usd: coin.usd,
        updatedAt: Date.now(),
        source: 'coingecko',
      };
      this.cache.set(coinId, { rate, expiresAt: Date.now() + this.TTL_MS });
      this.logger.log(`CoinGecko: ${coinId} = ₦${coin.ngn} / $${coin.usd}`);
      return rate;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`All rate sources failed for ${coinId}: ${msg}`);
      if (cached) {
        this.logger.warn(`Returning stale cache for ${coinId}`);
        return cached.rate;
      }
      throw new InternalServerErrorException(`Failed to fetch rate: ${msg}`);
    }
  }

  async getAllRates(): Promise<Record<string, TokenRate>> {
    const coinIds = Object.values(CHAIN_COIN_ID);
    const allCached = coinIds.every((id) => {
      const c = this.cache.get(id);
      return c && Date.now() < c.expiresAt;
    });
    if (allCached) {
      return Object.fromEntries(
        coinIds.map((id) => [id, this.cache.get(id)!.rate]),
      );
    }

    const result: Record<string, TokenRate> = {};
    await Promise.all(
      coinIds.map(async (id) => {
        try {
          result[id] = await this.getRate(id);
        } catch {
          // skip failed coins
        }
      }),
    );
    return result;
  }

  async convertNgnToToken(chainId: number, ngnAmount: number) {
    const coinId = CHAIN_COIN_ID[chainId];
    if (!coinId)
      throw new InternalServerErrorException(`Unsupported chain: ${chainId}`);
    const { ngn, source } = await this.getRate(coinId);
    return {
      tokenAmount: (ngnAmount / ngn).toFixed(6),
      rate: ngn,
      coinId,
      source,
    };
  }
}
