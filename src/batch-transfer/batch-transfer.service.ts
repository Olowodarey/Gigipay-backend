import { Injectable } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import type { Address } from 'viem';
import { BuildBatchTransferDto } from './dto/batch-transfer.dto';

@Injectable()
export class BatchTransferService {
  constructor(private blockchain: BlockchainService) {}

  buildBatchTransferTx(dto: BuildBatchTransferDto) {
    const recipients = dto.recipients.map((r) => r.address as Address);
    const amounts = dto.recipients.map((r) => BigInt(r.amount));

    const tx = this.blockchain.buildBatchTransferTx(
      dto.chainId,
      dto.token as Address,
      recipients,
      amounts,
    );

    return {
      ...tx,
      value: tx.value?.toString(),
    };
  }

  async isContractPaused(chainId: number) {
    return this.blockchain.isContractPaused(chainId);
  }
}
