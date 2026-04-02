import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Address,
  type PublicClient,
  type WalletClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, base } from 'viem/chains';
import { GIGIPAY_ABI } from './abi';

export const SUPPORTED_CHAINS = {
  [celo.id]: celo,
  [base.id]: base,
} as const;

export const CONTRACT_ADDRESSES: Record<number, Address> = {
  [celo.id]: '0x7B7750Fb5f0ce9C908fCc0674F8B35782F6d40B3',
  [base.id]: '0xEdc6abb2f1A25A191dAf8B648c1A3686EfFE6Dd6',
};

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private publicClients: Map<number, PublicClient> = new Map();

  constructor(private config: ConfigService) {}

  onModuleInit() {
    // Initialize public clients for each supported chain
    this.publicClients.set(
      celo.id,
      createPublicClient({
        chain: celo,
        transport: http(this.config.get('celo.rpcUrl')),
      }),
    );

    this.publicClients.set(
      base.id,
      createPublicClient({
        chain: base,
        transport: http(this.config.get('base.rpcUrl')),
      }),
    );

    this.logger.log('Blockchain clients initialized for Celo and Base');
  }

  getPublicClient(chainId: number): PublicClient {
    const client = this.publicClients.get(chainId);
    if (!client) throw new Error(`No client for chain ${chainId}`);
    return client;
  }

  getContractAddress(chainId: number): Address {
    const address = CONTRACT_ADDRESSES[chainId];
    if (!address) throw new Error(`Contract not deployed on chain ${chainId}`);
    return address;
  }

  // ─── Read Functions ───────────────────────────────────────────────────────

  async getVoucher(chainId: number, voucherId: bigint) {
    const client = this.getPublicClient(chainId);
    const address = this.getContractAddress(chainId);

    const data = await client.readContract({
      address,
      abi: GIGIPAY_ABI,
      functionName: 'vouchers',
      args: [voucherId],
    });

    return {
      sender: data[0] as Address,
      token: data[1] as Address,
      amount: data[2].toString(),
      claimCodeHash: data[3],
      expiresAt: data[4].toString(),
      claimed: data[5],
      refunded: data[6],
      voucherName: data[7],
    };
  }

  async getSenderVouchers(chainId: number, sender: Address): Promise<string[]> {
    const client = this.getPublicClient(chainId);
    const address = this.getContractAddress(chainId);

    const ids = await client.readContract({
      address,
      abi: GIGIPAY_ABI,
      functionName: 'getSenderVouchers',
      args: [sender],
    });

    return (ids as bigint[]).map((id) => id.toString());
  }

  async getVouchersByName(
    chainId: number,
    voucherName: string,
  ): Promise<string[]> {
    const client = this.getPublicClient(chainId);
    const address = this.getContractAddress(chainId);

    const ids = await client.readContract({
      address,
      abi: GIGIPAY_ABI,
      functionName: 'getVouchersByName',
      args: [voucherName],
    });

    return (ids as bigint[]).map((id) => id.toString());
  }

  async isVoucherClaimable(
    chainId: number,
    voucherId: bigint,
  ): Promise<boolean> {
    const client = this.getPublicClient(chainId);
    const address = this.getContractAddress(chainId);

    return client.readContract({
      address,
      abi: GIGIPAY_ABI,
      functionName: 'isVoucherClaimable',
      args: [voucherId],
    }) as Promise<boolean>;
  }

  async isVoucherRefundable(
    chainId: number,
    voucherId: bigint,
  ): Promise<boolean> {
    const client = this.getPublicClient(chainId);
    const address = this.getContractAddress(chainId);

    return client.readContract({
      address,
      abi: GIGIPAY_ABI,
      functionName: 'isVoucherRefundable',
      args: [voucherId],
    }) as Promise<boolean>;
  }

  async isContractPaused(chainId: number): Promise<boolean> {
    const client = this.getPublicClient(chainId);
    const address = this.getContractAddress(chainId);

    return client.readContract({
      address,
      abi: GIGIPAY_ABI,
      functionName: 'paused',
    }) as Promise<boolean>;
  }

  // ─── Write Tx Builders (return encoded calldata for frontend signing) ─────

  /**
   * Build batchTransfer calldata — frontend signs and sends
   */
  buildBatchTransferTx(
    chainId: number,
    token: Address,
    recipients: Address[],
    amounts: bigint[],
  ) {
    const address = this.getContractAddress(chainId);
    const isNative = token === '0x0000000000000000000000000000000000000000';
    const totalValue = isNative ? amounts.reduce((a, b) => a + b, 0n) : 0n;

    return {
      to: address,
      abi: GIGIPAY_ABI,
      functionName: 'batchTransfer' as const,
      args: [token, recipients, amounts] as const,
      value: totalValue,
    };
  }

  /**
   * Build createVoucherBatch calldata — frontend signs and sends
   */
  buildCreateVoucherBatchTx(
    chainId: number,
    token: Address,
    voucherName: string,
    claimCodes: string[],
    amounts: bigint[],
    expirationTimes: bigint[],
  ) {
    const address = this.getContractAddress(chainId);
    const isNative = token === '0x0000000000000000000000000000000000000000';
    const totalValue = isNative ? amounts.reduce((a, b) => a + b, 0n) : 0n;

    return {
      to: address,
      abi: GIGIPAY_ABI,
      functionName: 'createVoucherBatch' as const,
      args: [token, voucherName, claimCodes, amounts, expirationTimes] as const,
      value: totalValue,
    };
  }

  /**
   * Build claimVoucher calldata — frontend signs and sends
   */
  buildClaimVoucherTx(chainId: number, voucherName: string, claimCode: string) {
    const address = this.getContractAddress(chainId);
    return {
      to: address,
      abi: GIGIPAY_ABI,
      functionName: 'claimVoucher' as const,
      args: [voucherName, claimCode] as const,
    };
  }

  /**
   * Build refundVouchersByName calldata — frontend signs and sends
   */
  buildRefundVouchersTx(chainId: number, voucherName: string) {
    const address = this.getContractAddress(chainId);
    return {
      to: address,
      abi: GIGIPAY_ABI,
      functionName: 'refundVouchersByName' as const,
      args: [voucherName] as const,
    };
  }
}
