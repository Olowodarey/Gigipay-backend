import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, type Address } from 'viem';
import { celo, base } from 'viem/chains';
import { GIGIPAY_ABI } from './abi';

export const CONTRACT_ADDRESSES: Record<number, Address> = {
  [celo.id]: '0x7B7750Fb5f0ce9C908fCc0674F8B35782F6d40B3',
  [base.id]: '0xEdc6abb2f1A25A191dAf8B648c1A3686EfFE6Dd6',
};

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private publicClients = new Map<number, any>();

  constructor(private config: ConfigService) {}

  onModuleInit() {
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

  getPublicClient(chainId: number) {
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
      amount: (data[2] as bigint).toString(),
      claimCodeHash: data[3] as string,
      expiresAt: (data[4] as bigint).toString(),
      claimed: data[5] as boolean,
      refunded: data[6] as boolean,
      voucherName: data[7] as string,
    };
  }

  async getSenderVouchers(chainId: number, sender: Address): Promise<string[]> {
    const client = this.getPublicClient(chainId);
    const ids = await client.readContract({
      address: this.getContractAddress(chainId),
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
    const ids = await client.readContract({
      address: this.getContractAddress(chainId),
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
    return client.readContract({
      address: this.getContractAddress(chainId),
      abi: GIGIPAY_ABI,
      functionName: 'isVoucherClaimable',
      args: [voucherId],
    });
  }

  async isVoucherRefundable(
    chainId: number,
    voucherId: bigint,
  ): Promise<boolean> {
    const client = this.getPublicClient(chainId);
    return client.readContract({
      address: this.getContractAddress(chainId),
      abi: GIGIPAY_ABI,
      functionName: 'isVoucherRefundable',
      args: [voucherId],
    });
  }

  async isContractPaused(chainId: number): Promise<boolean> {
    const client = this.getPublicClient(chainId);
    return client.readContract({
      address: this.getContractAddress(chainId),
      abi: GIGIPAY_ABI,
      functionName: 'paused',
    });
  }

  // ─── Tx Builders (return tx data for frontend to sign) ───────────────────

  buildBatchTransferTx(
    chainId: number,
    token: Address,
    recipients: Address[],
    amounts: bigint[],
  ) {
    const isNative = token === '0x0000000000000000000000000000000000000000';
    return {
      to: this.getContractAddress(chainId),
      abi: GIGIPAY_ABI,
      functionName: 'batchTransfer' as const,
      args: [token, recipients, amounts] as const,
      value: isNative ? amounts.reduce((a, b) => a + b, 0n) : 0n,
    };
  }

  buildCreateVoucherBatchTx(
    chainId: number,
    token: Address,
    voucherName: string,
    claimCodes: string[],
    amounts: bigint[],
    expirationTimes: bigint[],
  ) {
    const isNative = token === '0x0000000000000000000000000000000000000000';
    return {
      to: this.getContractAddress(chainId),
      abi: GIGIPAY_ABI,
      functionName: 'createVoucherBatch' as const,
      args: [token, voucherName, claimCodes, amounts, expirationTimes] as const,
      value: isNative ? amounts.reduce((a, b) => a + b, 0n) : 0n,
    };
  }

  buildClaimVoucherTx(chainId: number, voucherName: string, claimCode: string) {
    return {
      to: this.getContractAddress(chainId),
      abi: GIGIPAY_ABI,
      functionName: 'claimVoucher' as const,
      args: [voucherName, claimCode] as const,
    };
  }

  buildRefundVouchersTx(chainId: number, voucherName: string) {
    return {
      to: this.getContractAddress(chainId),
      abi: GIGIPAY_ABI,
      functionName: 'refundVouchersByName' as const,
      args: [voucherName] as const,
    };
  }
}
