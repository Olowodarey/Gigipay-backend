import { Module } from '@nestjs/common';
import { BatchTransferController } from './batch-transfer.controller';
import { BatchTransferService } from './batch-transfer.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [BlockchainModule],
  controllers: [BatchTransferController],
  providers: [BatchTransferService],
})
export class BatchTransferModule {}
