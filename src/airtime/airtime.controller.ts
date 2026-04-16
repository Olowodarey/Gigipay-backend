import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AirtimeService } from './airtime.service';
import {
  BuildAirtimePayBillDto,
  BuyAirtimeDto,
  QueryAirtimeDto,
  CancelAirtimeDto,
  NelloResponse,
} from './dto/airtime.dto';
import { RegisterAirtimeOrderDto } from './dto/register-order.dto';

@ApiTags('airtime')
@Controller('airtime')
export class AirtimeController {
  constructor(private readonly service: AirtimeService) {}

  // ─── Tx Builder ──────────────────────────────────────────────────────────

  @Post('build/pay-bill')
  @ApiOperation({ summary: 'Build payBill transaction for frontend to sign' })
  buildPayBill(@Body() dto: BuildAirtimePayBillDto) {
    return this.service.buildPayBillTx(dto);
  }

  // ─── Order lifecycle ──────────────────────────────────────────────────────

  @Post('orders/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register an airtime order after tx is confirmed on-chain',
  })
  registerOrder(@Body() dto: RegisterAirtimeOrderDto) {
    return this.service.registerOrder(dto);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get airtime order status by internal ID' })
  getOrder(@Param('id') id: string) {
    return this.service.getOrder(id);
  }

  // ─── Nellobytesystems API ─────────────────────────────────────────────────

  @Get('networks')
  @ApiOperation({ summary: 'Get available networks and discount rates' })
  getNetworks(): Promise<NelloResponse> {
    return this.service.getNetworks();
  }

  @Post('buy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buy airtime directly via provider API' })
  buyAirtime(@Body() dto: BuyAirtimeDto): Promise<NelloResponse> {
    return this.service.buyAirtime(dto);
  }

  @Get('query')
  @ApiOperation({ summary: 'Query transaction status by orderId or requestId' })
  queryTransaction(@Query() dto: QueryAirtimeDto): Promise<NelloResponse> {
    return this.service.queryTransaction(dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending transaction by orderId' })
  cancelTransaction(@Body() dto: CancelAirtimeDto): Promise<NelloResponse> {
    return this.service.cancelTransaction(dto);
  }

  // ─── Callback ─────────────────────────────────────────────────────────────

  @Get('callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nellobytesystems callback endpoint (GET)' })
  handleCallback(@Query() payload: Record<string, string>) {
    return { received: true, payload };
  }
}
