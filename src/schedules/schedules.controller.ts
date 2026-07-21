import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/schedule.dto';

type AuthedReq = { user: { address: string } };

@ApiTags('schedules')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly service: SchedulesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a recurring payment schedule' })
  create(@Request() req: AuthedReq, @Body() dto: CreateScheduleDto) {
    return this.service.create(req.user.address, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the caller's schedules" })
  list(@Request() req: AuthedReq) {
    return this.service.findByOwner(req.user.address);
  }

  @Get('runs')
  @ApiOperation({
    summary: 'List recent run occurrences (pending ones need confirmation)',
  })
  runs(@Request() req: AuthedReq) {
    return this.service.listRuns(req.user.address);
  }

  @Post('runs/:runId/prepare')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Build the signable calldata for a due run (user signs in-wallet)',
  })
  prepareRun(@Request() req: AuthedReq, @Param('runId') runId: string) {
    return this.service.prepareRun(runId, req.user.address);
  }

  @Post('runs/:runId/signed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that the user signed a run (tx hash)' })
  markSigned(
    @Request() req: AuthedReq,
    @Param('runId') runId: string,
    @Body('txHash') txHash: string,
  ) {
    return this.service.markSigned(runId, req.user.address, txHash);
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause a schedule' })
  pause(@Request() req: AuthedReq, @Param('id') id: string) {
    return this.service.setStatus(id, req.user.address, 'paused');
  }

  @Patch(':id/resume')
  @ApiOperation({ summary: 'Resume a paused schedule' })
  resume(@Request() req: AuthedReq, @Param('id') id: string) {
    return this.service.setStatus(id, req.user.address, 'active');
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a schedule' })
  cancel(@Request() req: AuthedReq, @Param('id') id: string) {
    return this.service.setStatus(id, req.user.address, 'cancelled');
  }
}
