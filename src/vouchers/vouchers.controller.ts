import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { VouchersService } from './vouchers.service';
import {
  GetVoucherDto,
  GetSenderVouchersDto,
  GetVouchersByNameDto,
  BuildCreateVoucherDto,
  BuildClaimVoucherDto,
  BuildRefundVouchersDto,
} from './dto/voucher.dto';

@ApiTags('vouchers')
@Controller('vouchers')
export class VouchersController {
  constructor(private readonly service: VouchersService) {}

  @Get()
  @ApiOperation({ summary: 'Get voucher details by ID' })
  getVoucher(@Query() dto: GetVoucherDto) {
    return this.service.getVoucher(dto.chainId, dto.voucherId);
  }

  @Get('by-sender')
  @ApiOperation({ summary: 'Get all voucher IDs created by a sender' })
  getSenderVouchers(@Query() dto: GetSenderVouchersDto) {
    return this.service.getSenderVouchers(dto.chainId, dto.sender);
  }

  @Get('by-name')
  @ApiOperation({ summary: 'Get all voucher IDs by voucher name' })
  getVouchersByName(@Query() dto: GetVouchersByNameDto) {
    return this.service.getVouchersByName(dto.chainId, dto.voucherName);
  }

  @Get('claimable')
  @ApiOperation({ summary: 'Check if a voucher is claimable' })
  isClaimable(@Query() dto: GetVoucherDto) {
    return this.service.isVoucherClaimable(dto.chainId, dto.voucherId);
  }

  @Get('refundable')
  @ApiOperation({ summary: 'Check if a voucher is refundable' })
  isRefundable(@Query() dto: GetVoucherDto) {
    return this.service.isVoucherRefundable(dto.chainId, dto.voucherId);
  }

  @Get('paused')
  @ApiOperation({ summary: 'Check if contract is paused' })
  isPaused(@Query('chainId') chainId: string) {
    return this.service.isContractPaused(Number(chainId));
  }

  // ─── Tx Builders ─────────────────────────────────────────────────────────

  @Post('build/create')
  @ApiOperation({
    summary: 'Build createVoucherBatch transaction for frontend to sign',
  })
  buildCreate(@Body() dto: BuildCreateVoucherDto) {
    const tx = this.service.buildCreateVoucherTx(dto);
    return { ...tx, value: tx.value?.toString() };
  }

  @Post('build/claim')
  @ApiOperation({
    summary: 'Build claimVoucher transaction for frontend to sign',
  })
  buildClaim(@Body() dto: BuildClaimVoucherDto) {
    return this.service.buildClaimVoucherTx(dto);
  }

  @Post('build/refund')
  @ApiOperation({
    summary: 'Build refundVouchersByName transaction for frontend to sign',
  })
  buildRefund(@Body() dto: BuildRefundVouchersDto) {
    return this.service.buildRefundVouchersTx(dto);
  }
}
