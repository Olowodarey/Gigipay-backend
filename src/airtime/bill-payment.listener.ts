import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { celo, base } from 'viem/chains';
import {
  BlockchainService,
  CONTRACT_ADDRESSES,
} from '../blockchain/blockchain.service';
import { AirtimeService } from './airtime.service';
import { GIGIPAY_ABI } from '../blockchain/abi';

type PublicClient = ReturnType<BlockchainService['getPublicClient']>;

/**
 * Per-chain poll interval (ms).
 *
 * We poll `eth_getLogs` on a timer instead of using `eth_newFilter` +
 * `eth_getFilterChanges`. Public/load-balanced RPCs (e.g. mainnet.base.org) are
 * stateless: a filter created on one node vanishes on the next request, which
 * throws "filter not found". `getLogs` is stateless and works everywhere.
 */
const POLL_INTERVAL_MS: Record<number, number> = {
  [celo.id]: 4_000, // Celo ~5s blocks
  [base.id]: 2_000, // Base ~2s blocks
};

// Cap the block range per poll so a large catch-up gap can't trip a provider's
// getLogs range limit — remaining blocks are picked up on the next tick.
const MAX_BLOCK_RANGE = 500n;

@Injectable()
export class BillPaymentListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillPaymentListener.name);
  private timers: NodeJS.Timeout[] = [];
  private lastBlock = new Map<number, bigint>();
  private polling = new Set<number>();

  constructor(
    private readonly blockchain: BlockchainService,
    private readonly airtime: AirtimeService,
  ) {}

  async onModuleInit() {
    await this.startListening(celo.id);
    await this.startListening(base.id);
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this.logger.log('Bill payment listeners stopped');
  }

  private async startListening(chainId: number) {
    const address = CONTRACT_ADDRESSES[chainId];
    if (!address) return;

    const client = this.blockchain.getPublicClient(chainId);
    const interval = POLL_INTERVAL_MS[chainId] ?? 4_000;

    // Start from the current block so we don't replay historical events.
    try {
      this.lastBlock.set(chainId, await client.getBlockNumber());
    } catch {
      this.logger.warn(
        `Chain ${chainId}: could not fetch current block; will initialise on first poll`,
      );
    }

    const timer = setInterval(() => {
      void this.poll(chainId, client, address);
    }, interval);
    this.timers.push(timer);

    this.logger.log(
      `Polling BillPaymentInitiated + BatchBillPaymentCompleted on chain ${chainId} ` +
        `at ${address} every ${interval}ms (getLogs)`,
    );
  }

  private async poll(chainId: number, client: PublicClient, address: string) {
    // Skip if the previous tick for this chain is still running.
    if (this.polling.has(chainId)) return;
    this.polling.add(chainId);
    try {
      const latest = await client.getBlockNumber();
      const from = this.lastBlock.get(chainId);
      if (from === undefined) {
        this.lastBlock.set(chainId, latest);
        return;
      }
      if (latest <= from) return;

      const start = from + 1n;
      const to = latest - start > MAX_BLOCK_RANGE ? start + MAX_BLOCK_RANGE : latest;

      const initiated = await client.getContractEvents({
        address: address as `0x${string}`,
        abi: GIGIPAY_ABI,
        eventName: 'BillPaymentInitiated',
        fromBlock: start,
        toBlock: to,
      });
      for (const log of initiated) {
        const args = log.args as {
          orderId?: bigint;
          serviceType?: string;
          serviceId?: string;
        };
        void this.handleEvent(chainId, args, log.transactionHash ?? null);
      }

      const batch = await client.getContractEvents({
        address: address as `0x${string}`,
        abi: GIGIPAY_ABI,
        eventName: 'BatchBillPaymentCompleted',
        fromBlock: start,
        toBlock: to,
      });
      for (const log of batch) {
        const args = log.args as {
          buyer?: `0x${string}`;
          serviceType?: string;
          recipientCount?: bigint;
          totalAmount?: bigint;
        };
        this.logger.log(
          `BatchBillPaymentCompleted: chain=${chainId} buyer=${args.buyer} ` +
            `serviceType=${args.serviceType} recipients=${args.recipientCount} ` +
            `totalAmount=${args.totalAmount} tx=${log.transactionHash}`,
        );
      }

      this.lastBlock.set(chainId, to);
    } catch (err) {
      this.logger.error(
        `Poll error on chain ${chainId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.polling.delete(chainId);
    }
  }

  private async handleEvent(
    chainId: number,
    args: {
      orderId?: bigint;
      serviceType?: string;
      serviceId?: string;
    },
    txHash: string | null,
  ) {
    const { orderId, serviceType } = args;
    if (orderId === undefined || !serviceType || !txHash) return;

    this.logger.log(
      `BillPaymentInitiated: chain=${chainId} orderId=${orderId} serviceType=${serviceType} tx=${txHash}`,
    );

    if (serviceType !== 'airtime') return;

    await this.airtime.fulfillFromChainEvent({ orderId, txHash, chainId });
  }
}
