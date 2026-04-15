import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { BlockchainModule } from './blockchain/blockchain.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { BatchTransferModule } from './batch-transfer/batch-transfer.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AirtimeModule } from './airtime/airtime.module';
import { UserEntity } from './users/user.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [UserEntity],
        synchronize: config.get('nodeEnv') !== 'production',
        logging: config.get('nodeEnv') === 'development',
      }),
    }),
    BlockchainModule,
    VouchersModule,
    BatchTransferModule,
    AuthModule,
    UsersModule,
    AirtimeModule,
  ],
})
export class AppModule {}
