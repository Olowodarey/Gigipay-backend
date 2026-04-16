import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AirtimeController } from './airtime.controller';
import { AirtimeService } from './airtime.service';
import { BillPaymentListener } from './bill-payment.listener';
import { AirtimeOrderEntity } from './airtime-order.entity';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    HttpModule,
    BlockchainModule,
    TypeOrmModule.forFeature([AirtimeOrderEntity]),
  ],
  controllers: [AirtimeController],
  providers: [AirtimeService, BillPaymentListener],
  exports: [AirtimeService],
})
export class AirtimeModule {}
