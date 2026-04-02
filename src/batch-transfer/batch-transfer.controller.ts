import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BatchTransferService } from './batch-transfer.service';
import { BuildBatchTransferDto } from './dto/batch-transfer.dto';

@ApiTags('batch-transfer')
@Controller('batch-transfer')
export class BatchTransferController {
  constructor(private readonly service: BatchTransferService) {}

  @Post('build')
  @ApiOperation({
    summary: 'Build batchTransfer transaction for frontend to sign',
  })
  buildBatchTransfer(@Body() dto: BuildBatchTransferDto) {
    return this.service.buildBatchTransferTx(dto);
  }

  @Get('paused')
  @ApiOperation({ summary: 'Check if contract is paused on a chain' })
  isPaused(@Query('chainId') chainId: string) {
    return this.service.isContractPaused(Number(chainId));
  }
}
