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

@Injectable()
export class BillPaymentListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillPaymentListener.name);
  private unwatchers: Array<() => void> = [];

  constructor(
    private readonly blockchain: BlockchainService,
    private readonly airtime: AirtimeService,
  ) {}

  onModuleInit() {
    this.startListening(celo.id);
    this.startListening(base.id);
  }

  onModuleDestroy() {
    this.unwatchers.forEach((fn) => fn());
    this.unwatchers = [];
    this.logger.log('Bill payment listeners stopped');
  }

  private startListening(chainId: number) {
    const address = CONTRACT_ADDRESSES[chainId];
    if (!address) return;

    const client = this.blockchain.getPublicClient(chainId);

    const unwatch = client.watchContractEvent({
      address,
      abi: GIGIPAY_ABI,
      eventName: 'BillPaymentInitiated',
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
      `Listening for BillPaymentInitiated on chain ${chainId} at ${address}`,
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
