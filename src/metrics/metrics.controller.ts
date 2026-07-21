import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Public aggregate stats (users, airtime, schedules, runs, activity, daily series). No auth, no per-user data. Cached 60s.',
  })
  getMetrics() {
    return this.service.getMetrics();
  }
}
