import { Injectable } from '@nestjs/common';
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
}

export interface ChainBalances {
  chainId: number;
  chainName: string;
  contractAddress: string;
  balances: TokenBalance[];
}

@Injectable()
export class BillsService {
  constructor(private readonly blockchain: BlockchainService) {}

  async getBalances(): Promise<ChainBalances[]> {
    const chains = [
      { id: celo.id, name: 'Celo' },
      { id: base.id, name: 'Base' },
    ];

    return Promise.all(
      chains.map(async (chain) => {
        const tokens = TRACKED_TOKENS[chain.id] ?? [];
        const contractAddress = this.blockchain.getContractAddress(chain.id);

        const balances = await Promise.all(
          tokens.map(async (token): Promise<TokenBalance> => {
            const isNative =
              token.address === '0x0000000000000000000000000000000000000000';

            const raw = isNative
              ? await this.blockchain.getContractNativeBalance(chain.id)
              : await this.blockchain.getContractTokenBalance(
                  chain.id,
                  token.address,
                );

            return {
              symbol: token.symbol,
              address: token.address,
              raw: raw.toString(),
              formatted: formatUnits(raw, token.decimals),
              decimals: token.decimals,
            };
          }),
        );

        return {
          chainId: chain.id,
          chainName: chain.name,
          contractAddress,
          balances,
        };
      }),
    );
  }

  async getBalancesByChain(chainId: number): Promise<ChainBalances> {
    const chainName = chainId === celo.id ? 'Celo' : 'Base';
    const tokens = TRACKED_TOKENS[chainId] ?? [];
    const contractAddress = this.blockchain.getContractAddress(chainId);

    const balances = await Promise.all(
      tokens.map(async (token): Promise<TokenBalance> => {
        const isNative =
          token.address === '0x0000000000000000000000000000000000000000';

        const raw = isNative
          ? await this.blockchain.getContractNativeBalance(chainId)
          : await this.blockchain.getContractTokenBalance(
              chainId,
              token.address,
            );

        return {
          symbol: token.symbol,
          address: token.address,
          raw: raw.toString(),
          formatted: formatUnits(raw, token.decimals),
          decimals: token.decimals,
        };
      }),
    );

    return { chainId, chainName, contractAddress, balances };
  }
}
