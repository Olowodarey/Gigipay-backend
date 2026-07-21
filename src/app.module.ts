import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { BlockchainModule } from './blockchain/blockchain.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { BatchTransferModule } from './batch-transfer/batch-transfer.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AirtimeModule } from './airtime/airtime.module';
import { RatesModule } from './rates/rates.module';
import { BillsModule } from './bills/bills.module';
import { AgentModule } from './agent/agent.module';
import { SchedulesModule } from './schedules/schedules.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MetricsModule } from './metrics/metrics.module';
import { UserEntity } from './users/user.entity';
import { AirtimeOrderEntity } from './airtime/airtime-order.entity';
import { ScheduleEntity } from './schedules/schedule.entity';
import { ScheduleRunEntity } from './schedules/schedule-run.entity';
import { PushSubscriptionEntity } from './notifications/push-subscription.entity';

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
        entities: [
          UserEntity,
          AirtimeOrderEntity,
          ScheduleEntity,
          ScheduleRunEntity,
          PushSubscriptionEntity,
        ],
        synchronize: true, // Always sync to ensure tables exist
        migrationsRun: config.get('nodeEnv') === 'production',
        logging: config.get('nodeEnv') === 'development',
        ssl:
          config.get('nodeEnv') === 'production'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
    ScheduleModule.forRoot(),
    BlockchainModule,
    VouchersModule,
    BatchTransferModule,
    AuthModule,
    UsersModule,
    AirtimeModule,
    RatesModule,
    BillsModule,
    AgentModule,
    NotificationsModule,
    SchedulesModule,
    MetricsModule,
  ],
})
export class AppModule {}
