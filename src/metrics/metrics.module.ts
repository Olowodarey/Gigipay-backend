import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { UserEntity } from '../users/user.entity';
import { AirtimeOrderEntity } from '../airtime/airtime-order.entity';
import { ScheduleEntity } from '../schedules/schedule.entity';
import { ScheduleRunEntity } from '../schedules/schedule-run.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      AirtimeOrderEntity,
      ScheduleEntity,
      ScheduleRunEntity,
    ]),
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
