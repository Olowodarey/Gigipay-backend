import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BillsService } from './bills.service';

@ApiTags('bills')
@Controller('bills')
export class BillsController {
  constructor(private readonly service: BillsService) {}

  @Get('balances')
  @ApiOperation({
    summary: 'Get contract bill-fund balances across all supported chains',
  })
  getBalances() {
    return this.service.getBalances();
  }

  @Get('balances/chain')
  @ApiOperation({
    summary: 'Get contract bill-fund balances for a specific chain',
  })
  @ApiQuery({ name: 'chainId', example: 42220 })
  getBalancesByChain(@Query('chainId') chainId: string) {
    return this.service.getBalancesByChain(Number(chainId));
  }
}
