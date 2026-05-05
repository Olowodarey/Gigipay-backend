import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { parseAbiItem } from 'viem';
import { celo, base } from 'viem/chains';
import {
  BlockchainService,
  CONTRACT_ADDRESSES,
} from '../blockchain/blockchain.service';
import { AirtimeService } from './airtime.service';

/**
 * Max blocks to scan per poll per chain.
 * Ankr free tier allows ~2000 blocks per eth_getLogs call.
 * Celo: ~5s/block → 2000 blocks ≈ 2.8 hours of history per poll.
 * Base: ~2s/block → 2000 blocks ≈ 1.1 hours of history per poll.
 */
const MAX_BLOCK_RANGE = 1999n;

/** How often to poll for new events (ms) */
const POLL_INTERVAL_MS = 5_000;

@Injectable()
export class BillPaymentListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillPaymentListener.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly blockchain: BlockchainService,
    private readonly airtime: AirtimeService,
  ) {}

  onModuleInit() {
    void this.startPolling(celo.id);
    void this.startPolling(base.id);
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this.logger.log('Bill payment listeners stopped');
  }

  private async startPolling(chainId: number) {
    const address = CONTRACT_ADDRESSES[chainId];
    if (!address) return;

    const client = this.blockchain.getPublicClient(chainId);

    // Start from the current block so we don't scan chain history
    let lastBlock: bigint;
    try {
      lastBlock = await client.getBlockNumber();
    } catch (err) {
      this.logger.error(
        `Failed to get block number for chain ${chainId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Retry after a delay
      const t = setTimeout(() => void this.startPolling(chainId), 10_000);
      this.timers.push(t as unknown as NodeJS.Timeout);
      return;
    }

    this.logger.log(
      `Polling BillPaymentInitiated on chain ${chainId} at ${address} from block ${lastBlock}`,
    );

    const poll = async () => {
      try {
        const currentBlock = await client.getBlockNumber();
        if (currentBlock <= lastBlock) return;

        // Cap the range to avoid "block range too large" errors
        const fromBlock = lastBlock + 1n;
        const toBlock =
          currentBlock - fromBlock > MAX_BLOCK_RANGE
            ? fromBlock + MAX_BLOCK_RANGE
            : currentBlock;

        const logs = await client.getLogs({
          address,
          event: parseAbiItem(
            'event BillPaymentInitiated(uint256 indexed orderId, address indexed buyer, address token, uint256 amount, string serviceType, string serviceId, bytes32 recipientHash)',
          ),
          fromBlock,
          toBlock,
        });

        for (const log of logs) {
          const { orderId, serviceType } = log.args as {
            orderId?: bigint;
            serviceType?: string;
          };
          const txHash = log.transactionHash ?? null;

          if (!orderId || !serviceType || !txHash) continue;

          this.logger.log(
            `BillPaymentInitiated: chain=${chainId} orderId=${orderId} serviceType=${serviceType} tx=${txHash}`,
          );

          if (serviceType === 'airtime') {
            await this.airtime.fulfillFromChainEvent({
              orderId,
              txHash,
              chainId,
            });
          }
        }

        // Advance cursor — if we capped the range, next poll picks up from toBlock
        lastBlock = toBlock;
      } catch (err) {
        // Log but don't crash — next interval will retry
        this.logger.error(
          `Poll error on chain ${chainId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    // Run immediately then on interval
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    this.timers.push(timer);
  }
}
