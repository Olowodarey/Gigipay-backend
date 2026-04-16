import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';

export const CHAIN_COIN_ID: Record<number, string> = {
  42220: 'celo',
  8453: 'ethereum',
};

export interface TokenRate {
  coinId: string;
  ngn: number;
  usd: number;
  updatedAt: number;
}

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private cache = new Map<string, { rate: TokenRate; expiresAt: number }>();
  private readonly TTL_MS = 60_000;

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  private async fetchFromCoinGecko(
    coinIds: string,
  ): Promise<Record<string, { ngn: number; usd: number }>> {
    const apiKey = this.config.get<string>('coingecko.apiKey');

    // Use pro endpoint if key present, otherwise public endpoint
    const baseUrl = apiKey
      ? 'https://pro-api.coingecko.com/api/v3/simple/price'
      : 'https://api.coingecko.com/api/v3/simple/price';

    const headers: Record<string, string> = {};
    if (apiKey) headers['x-cg-pro-api-key'] = apiKey;

    this.logger.debug(`Fetching rates for: ${coinIds}`);

    const { data } = await firstValueFrom(
      this.http
        .get<Record<string, { ngn: number; usd: number }>>(baseUrl, {
          params: { ids: coinIds, vs_currencies: 'ngn,usd' },
          headers,
        })
        .pipe(timeout(8000)),
    );

    this.logger.debug(`CoinGecko response: ${JSON.stringify(data)}`);
    return data;
  }

  async getRate(coinId: string): Promise<TokenRate> {
    const cached = this.cache.get(coinId);
    if (cached && Date.now() < cached.expiresAt) return cached.rate;

    try {
      const data = await this.fetchFromCoinGecko(coinId);
      const coin = data[coinId];
      if (!coin) throw new Error(`CoinGecko returned empty data for ${coinId}`);

      const rate: TokenRate = {
        coinId,
        ngn: coin.ngn,
        usd: coin.usd,
        updatedAt: Date.now(),
      };
      this.cache.set(coinId, { rate, expiresAt: Date.now() + this.TTL_MS });
      this.logger.log(`Rate cached: ${coinId} = ₦${coin.ngn} / $${coin.usd}`);
      return rate;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`CoinGecko failed for ${coinId}: ${msg}`);
      if (cached) {
        this.logger.warn(`Returning stale cache for ${coinId}`);
        return cached.rate;
      }
      throw new InternalServerErrorException(
        `Failed to fetch rate for ${coinId}: ${msg}`,
      );
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

    try {
      const data = await this.fetchFromCoinGecko(coinIds.join(','));
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
      this.logger.error(`Bulk fetch failed: ${msg}`);
      const stale: Record<string, TokenRate> = {};
      for (const id of coinIds) {
        const c = this.cache.get(id);
        if (c) stale[id] = c.rate;
      }
      if (Object.keys(stale).length) return stale;
      throw new InternalServerErrorException(`Failed to fetch rates: ${msg}`);
    }
  }

  async convertNgnToToken(chainId: number, ngnAmount: number) {
    const coinId = CHAIN_COIN_ID[chainId];
    if (!coinId)
      throw new InternalServerErrorException(`Unsupported chain: ${chainId}`);
    const { ngn } = await this.getRate(coinId);
    return { tokenAmount: (ngnAmount / ngn).toFixed(6), rate: ngn, coinId };
  }
}
