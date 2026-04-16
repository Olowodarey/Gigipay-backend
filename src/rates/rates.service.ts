import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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

  // ─── Private helper — single place that calls CoinGecko ──────────────────

  private async fetchFromCoinGecko(
    coinIds: string,
  ): Promise<Record<string, { ngn: number; usd: number }>> {
    const apiKey = this.config.get<string>('coingecko.apiKey');

    // Pass key as header (recommended) — avoids axios param serialisation issues
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

    const { data } = await firstValueFrom(
      this.http.get<Record<string, { ngn: number; usd: number }>>(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: { ids: coinIds, vs_currencies: 'ngn,usd' },
          headers,
        },
      ),
    );

    return data;
  }

  // ─── Public methods ───────────────────────────────────────────────────────

  async getRate(coinId: string): Promise<TokenRate> {
    const cached = this.cache.get(coinId);
    if (cached && Date.now() < cached.expiresAt) return cached.rate;

    try {
      const data = await this.fetchFromCoinGecko(coinId);
      const coin = data[coinId];
      if (!coin) throw new Error(`No data for ${coinId}`);

      const rate: TokenRate = {
        coinId,
        ngn: coin.ngn,
        usd: coin.usd,
        updatedAt: Date.now(),
      };
      this.cache.set(coinId, { rate, expiresAt: Date.now() + this.TTL_MS });
      this.logger.log(`Rate: ${coinId} = ₦${coin.ngn} / $${coin.usd}`);
      return rate;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`CoinGecko failed for ${coinId}: ${msg}`);
      if (cached) return cached.rate; // stale fallback
      throw new InternalServerErrorException('Failed to fetch exchange rate');
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
      this.logger.error(`CoinGecko bulk fetch failed: ${msg}`);
      const stale: Record<string, TokenRate> = {};
      for (const id of coinIds) {
        const c = this.cache.get(id);
        if (c) stale[id] = c.rate;
      }
      if (Object.keys(stale).length) return stale;
      throw new InternalServerErrorException('Failed to fetch exchange rates');
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
