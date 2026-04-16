import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// Supported CoinGecko coin IDs per chain
export const CHAIN_COIN_ID: Record<number, string> = {
  42220: 'celo', // Celo → CELO
  8453: 'ethereum', // Base → ETH
};

export interface TokenRate {
  coinId: string;
  ngn: number;
  usd: number;
  updatedAt: number; // unix ms
}

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private cache = new Map<string, { rate: TokenRate; expiresAt: number }>();
  private readonly TTL_MS = 60_000; // 60 second cache

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  /**
   * Get NGN & USD rate for a given CoinGecko coin ID.
   * Results are cached for 60 seconds to stay within free-tier limits.
   */
  async getRate(coinId: string): Promise<TokenRate> {
    const cached = this.cache.get(coinId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.rate;
    }

    const apiKey = this.config.get<string>('coingecko.apiKey');
    const url = `https://api.coingecko.com/api/v3/simple/price`;

    const params: Record<string, string> = {
      ids: coinId,
      vs_currencies: 'ngn,usd',
    };
    if (apiKey) params['x_cg_demo_api_key'] = apiKey;

    try {
      const { data } = await firstValueFrom(
        this.http.get<Record<string, { ngn: number; usd: number }>>(url, {
          params,
        }),
      );

      const coin = data[coinId];
      if (!coin) throw new Error(`CoinGecko returned no data for ${coinId}`);

      const rate: TokenRate = {
        coinId,
        ngn: coin.ngn,
        usd: coin.usd,
        updatedAt: Date.now(),
      };

      this.cache.set(coinId, { rate, expiresAt: Date.now() + this.TTL_MS });
      this.logger.debug(
        `Rate fetched: ${coinId} = ₦${coin.ngn} / $${coin.usd}`,
      );
      return rate;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`CoinGecko fetch failed for ${coinId}: ${msg}`);
      // Return stale cache if available rather than hard-failing
      if (cached) {
        this.logger.warn(`Returning stale cache for ${coinId}`);
        return cached.rate;
      }
      throw new InternalServerErrorException('Failed to fetch exchange rate');
    }
  }

  /**
   * Get rates for both Celo and Base native tokens in one call.
   */
  async getAllRates(): Promise<Record<string, TokenRate>> {
    const coinIds = Object.values(CHAIN_COIN_ID);
    const apiKey = this.config.get<string>('coingecko.apiKey');
    const url = `https://api.coingecko.com/api/v3/simple/price`;

    // Check if all are cached
    const allCached = coinIds.every((id) => {
      const c = this.cache.get(id);
      return c && Date.now() < c.expiresAt;
    });

    if (allCached) {
      return Object.fromEntries(
        coinIds.map((id) => [id, this.cache.get(id)!.rate]),
      );
    }

    const params: Record<string, string> = {
      ids: coinIds.join(','),
      vs_currencies: 'ngn,usd',
    };
    if (apiKey) params['x_cg_demo_api_key'] = apiKey;

    try {
      const { data } = await firstValueFrom(
        this.http.get<Record<string, { ngn: number; usd: number }>>(url, {
          params,
        }),
      );

      const result: Record<string, TokenRate> = {};
      for (const id of coinIds) {
        const coin = data[id];
        if (!coin) continue;
        const rate: TokenRate = {
          coinId: id,
          ngn: coin.ngn,
          usd: coin.usd,
          updatedAt: Date.now(),
        };
        this.cache.set(id, { rate, expiresAt: Date.now() + this.TTL_MS });
        result[id] = rate;
      }
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`CoinGecko bulk fetch failed: ${msg}`);
      // Return whatever is in cache
      const stale: Record<string, TokenRate> = {};
      for (const id of coinIds) {
        const c = this.cache.get(id);
        if (c) stale[id] = c.rate;
      }
      if (Object.keys(stale).length) return stale;
      throw new InternalServerErrorException('Failed to fetch exchange rates');
    }
  }

  /**
   * Convert an NGN amount to the equivalent token amount for a given chain.
   * Returns the token amount as a string with 6 decimal places.
   */
  async convertNgnToToken(
    chainId: number,
    ngnAmount: number,
  ): Promise<{
    tokenAmount: string;
    rate: number;
    coinId: string;
  }> {
    const coinId = CHAIN_COIN_ID[chainId];
    if (!coinId)
      throw new InternalServerErrorException(`Unsupported chain: ${chainId}`);

    const { ngn } = await this.getRate(coinId);
    const tokenAmount = ngnAmount / ngn;

    return {
      tokenAmount: tokenAmount.toFixed(6),
      rate: ngn,
      coinId,
    };
  }
}
