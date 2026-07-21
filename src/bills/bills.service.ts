import { Injectable, Logger } from '@nestjs/common';
import { formatUnits, type Address } from 'viem';
import { celo, base } from 'viem/chains';
import { BlockchainService } from '../blockchain/blockchain.service';

// All tokens we track per chain: address + decimals + symbol
const TRACKED_TOKENS: Record<
  number,
  Array<{ symbol: string; address: Address; decimals: number }>
> = {
  [celo.id]: [
    {
      symbol: 'CELO',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
    },
    {
      symbol: 'cUSD',
      address: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
      decimals: 18,
    },
    {
      symbol: 'USDC',
      address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      decimals: 6,
    },
    {
      symbol: 'USDT',
      address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
      decimals: 6,
    },
  ],
  [base.id]: [
    {
      symbol: 'ETH',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
    },
    {
      symbol: 'USDC',
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
    },
  ],
};

export interface TokenBalance {
  symbol: string;
  address: string;
  raw: string; // wei / smallest unit as string
  formatted: string; // human-readable e.g. "12.345678"
  decimals: number;
  unavailable?: boolean; // true if this RPC read failed (shown as 0)
}

export interface ChainBalances {
  chainId: number;
  chainName: string;
  contractAddress: string;
  balances: TokenBalance[];
  error?: boolean; // true if this chain's reads couldn't be completed
}

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(private readonly blockchain: BlockchainService) {}

  async getBalances(): Promise<ChainBalances[]> {
    const chains = [
      { id: celo.id, name: 'Celo' },
      { id: base.id, name: 'Base' },
    ];
    // Each chain is independent — a flaky RPC on one must not fail the others.
    return Promise.all(
      chains.map((chain) => this.getChainBalances(chain.id, chain.name)),
    );
  }

  async getBalancesByChain(chainId: number): Promise<ChainBalances> {
    return this.getChainBalances(chainId, chainId === celo.id ? 'Celo' : 'Base');
  }

  /** Read all tracked-token balances for one chain, tolerating RPC failures. */
  private async getChainBalances(
    chainId: number,
    chainName: string,
  ): Promise<ChainBalances> {
    const tokens = TRACKED_TOKENS[chainId] ?? [];
    const contractAddress = this.blockchain.getContractAddress(chainId);

    const results = await Promise.all(
      tokens.map((token) => this.readTokenBalance(chainId, token)),
    );
    const error = results.some((b) => b.unavailable);
    return { chainId, chainName, contractAddress, balances: results, error };
  }

  /** Never throws — on RPC failure returns a 0 balance flagged `unavailable`. */
  private async readTokenBalance(
    chainId: number,
    token: { symbol: string; address: Address; decimals: number },
  ): Promise<TokenBalance> {
    const isNative =
      token.address === '0x0000000000000000000000000000000000000000';
    try {
      const raw = isNative
        ? await this.blockchain.getContractNativeBalance(chainId)
        : await this.blockchain.getContractTokenBalance(chainId, token.address);
      return {
        symbol: token.symbol,
        address: token.address,
        raw: raw.toString(),
        formatted: formatUnits(raw, token.decimals),
        decimals: token.decimals,
      };
    } catch (err) {
      this.logger.warn(
        `Balance read failed chain=${chainId} token=${token.symbol}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        symbol: token.symbol,
        address: token.address,
        raw: '0',
        formatted: '0',
        decimals: token.decimals,
        unavailable: true,
      };
    }
  }
}
