import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { BlockchainModule } from './blockchain/blockchain.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { BatchTransferModule } from './batch-transfer/batch-transfer.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    BlockchainModule,
    VouchersModule,
    BatchTransferModule,
    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}
