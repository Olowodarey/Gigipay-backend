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

/**
 * Chain-specific listener config.
 *
 * - poll: true  → uses eth_getLogs on a timer (works on stateless/load-balanced RPCs like mainnet.base.org)
 * - poll: false → uses eth_newFilter + eth_getFilterChanges (requires sticky/stateful RPC)
 *
 * Base public RPC is stateless, so we must poll.
 * Celo (Ankr) supports filters but has a block-range limit, so we also poll to avoid
 * the "Block range is too large" error that occurs when catching up from a stale fromBlock.
 */
const CHAIN_POLL_CONFIG: Record<
  number,
  { poll: true; pollingInterval: number }
> = {
  [celo.id]: { poll: true, pollingInterval: 4_000 }, // Celo ~5s blocks
  [base.id]: { poll: true, pollingInterval: 2_000 }, // Base ~2s blocks
};

@Injectable()
export class BillPaymentListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillPaymentListener.name);
  private unwatchers: Array<() => void> = [];

  constructor(
    private readonly blockchain: BlockchainService,
    private readonly airtime: AirtimeService,
  ) {}

  async onModuleInit() {
    await this.startListening(celo.id);
    await this.startListening(base.id);
  }

  onModuleDestroy() {
    this.unwatchers.forEach((fn) => fn());
    this.unwatchers = [];
    this.logger.log('Bill payment listeners stopped');
  }

  private async startListening(chainId: number) {
    const address = CONTRACT_ADDRESSES[chainId];
    if (!address) return;

    const client = this.blockchain.getPublicClient(chainId);
    const config = CHAIN_POLL_CONFIG[chainId] ?? {
      poll: true,
      pollingInterval: 4_000,
    };

    // Start watching from the current block to avoid replaying old events
    // and to prevent "block range too large" errors on catch-up.
    let fromBlock: bigint;
    try {
      fromBlock = await client.getBlockNumber();
      this.logger.log(
        `Chain ${chainId}: starting listener from block ${fromBlock}`,
      );
    } catch {
      this.logger.warn(
        `Chain ${chainId}: could not fetch current block, starting from "latest"`,
      );
      fromBlock = undefined as unknown as bigint;
    }

    const unwatch = client.watchContractEvent({
      address,
      abi: GIGIPAY_ABI,
      eventName: 'BillPaymentInitiated',
      fromBlock,
      poll: config.poll,
      pollingInterval: config.pollingInterval,
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            orderId?: bigint;
            buyer?: `0x${string}`;
            serviceType?: string;
            serviceId?: string;
            recipientHash?: `0x${string}`;
          };
          void this.handleEvent(chainId, args, log.transactionHash ?? null);
        }
      },
      onError: (err) => {
        this.logger.error(`Listener error on chain ${chainId}: ${err.message}`);
      },
    });

    this.unwatchers.push(unwatch);
    this.logger.log(
      `Listening for BillPaymentInitiated on chain ${chainId} at ${address} (poll=${config.poll})`,
    );

    // Also listen for batch events for logging/monitoring
    const unwatchBatch = client.watchContractEvent({
      address,
      abi: GIGIPAY_ABI,
      eventName: 'BatchBillPaymentCompleted',
      fromBlock,
      poll: config.poll,
      pollingInterval: config.pollingInterval,
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            buyer?: `0x${string}`;
            token?: `0x${string}`;
            totalAmount?: bigint;
            serviceType?: string;
            recipientCount?: bigint;
          };
          this.logger.log(
            `BatchBillPaymentCompleted: chain=${chainId} buyer=${args.buyer} ` +
              `serviceType=${args.serviceType} recipients=${args.recipientCount} ` +
              `totalAmount=${args.totalAmount} tx=${log.transactionHash}`,
          );
        }
      },
      onError: (err) => {
        this.logger.error(
          `Batch listener error on chain ${chainId}: ${err.message}`,
        );
      },
    });

    this.unwatchers.push(unwatchBatch);
    this.logger.log(
      `Listening for BatchBillPaymentCompleted on chain ${chainId} at ${address} (poll=${config.poll})`,
    );
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
    if (!orderId || !serviceType || !txHash) return;

    this.logger.log(
      `BillPaymentInitiated: chain=${chainId} orderId=${orderId} serviceType=${serviceType} tx=${txHash}`,
    );

    if (serviceType !== 'airtime') return;

    await this.airtime.fulfillFromChainEvent({ orderId, txHash, chainId });
  }
}
