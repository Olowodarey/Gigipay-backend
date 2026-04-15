import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AirtimeController } from './airtime.controller';
import { AirtimeService } from './airtime.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [HttpModule, BlockchainModule],
  controllers: [AirtimeController],
  providers: [AirtimeService],
  exports: [AirtimeService],
})
export class AirtimeModule {}
