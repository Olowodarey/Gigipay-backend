import { Injectable, BadRequestException } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import type { Address } from 'viem';
import {
  BuildCreateVoucherDto,
  BuildClaimVoucherDto,
  BuildRefundVouchersDto,
} from './dto/voucher.dto';

@Injectable()
export class VouchersService {
  constructor(private blockchain: BlockchainService) {}

  async getVoucher(chainId: number, voucherId: string) {
    return this.blockchain.getVoucher(chainId, BigInt(voucherId));
  }

  async getSenderVouchers(chainId: number, sender: string) {
    return this.blockchain.getSenderVouchers(chainId, sender as Address);
  }

  async getVouchersByName(chainId: number, voucherName: string) {
    return this.blockchain.getVouchersByName(chainId, voucherName);
  }

  async isVoucherClaimable(chainId: number, voucherId: string) {
    return this.blockchain.isVoucherClaimable(chainId, BigInt(voucherId));
  }

  async isVoucherRefundable(chainId: number, voucherId: string) {
    return this.blockchain.isVoucherRefundable(chainId, BigInt(voucherId));
  }

  async isContractPaused(chainId: number) {
    return this.blockchain.isContractPaused(chainId);
  }

  // ─── Tx Builders (return tx data for frontend to sign) ───────────────────

  buildCreateVoucherTx(dto: BuildCreateVoucherDto) {
    if (
      dto.claimCodes.length !== dto.amounts.length ||
      dto.amounts.length !== dto.expirationTimes.length
    ) {
      throw new BadRequestException(
        'claimCodes, amounts, and expirationTimes must have the same length',
      );
    }

    return this.blockchain.buildCreateVoucherBatchTx(
      dto.chainId,
      dto.token as Address,
      dto.voucherName,
      dto.claimCodes,
      dto.amounts.map((a) => BigInt(a)),
      dto.expirationTimes.map((t) => BigInt(t)),
    );
  }

  buildClaimVoucherTx(dto: BuildClaimVoucherDto) {
    return this.blockchain.buildClaimVoucherTx(
      dto.chainId,
      dto.voucherName,
      dto.claimCode,
    );
  }

  buildRefundVouchersTx(dto: BuildRefundVouchersDto) {
    return this.blockchain.buildRefundVouchersTx(dto.chainId, dto.voucherName);
  }
}
