import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RatesService, CHAIN_COIN_ID } from './rates.service';

@ApiTags('rates')
@Controller('rates')
export class RatesController {
  constructor(private readonly service: RatesService) {}

  @Get()
  @ApiOperation({ summary: 'Get NGN & USD rates for all supported chains' })
  getAllRates() {
    return this.service.getAllRates();
  }

  @Get('convert')
  @ApiOperation({
    summary: 'Convert NGN amount to token equivalent for a chain',
  })
  @ApiQuery({ name: 'chainId', example: 42220 })
  @ApiQuery({ name: 'amount', example: 100 })
  convert(@Query('chainId') chainId: string, @Query('amount') amount: string) {
    return this.service.convertNgnToToken(Number(chainId), Number(amount));
  }

  @Get('supported-chains')
  @ApiOperation({
    summary: 'List supported chain IDs and their CoinGecko coin IDs',
  })
  supportedChains() {
    return CHAIN_COIN_ID;
  }
}
