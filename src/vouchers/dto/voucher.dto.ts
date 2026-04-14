import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsArray, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class GetVoucherDto {
  @ApiProperty({
    example: 42220,
    description: 'Chain ID (42220=Celo, 8453=Base)',
  })
  @IsNumber()
  @Type(() => Number)
  chainId: number;

  @ApiProperty({ example: '1' })
  @IsString()
  voucherId: string;
}

export class GetSenderVouchersDto {
  @ApiProperty({ example: 42220 })
  @IsNumber()
  @Type(() => Number)
  chainId: number;

  @ApiProperty({ example: '0xabc...' })
  @IsString()
  sender: string;
}

export class GetVouchersByNameDto {
  @ApiProperty({ example: 42220 })
  @IsNumber()
  @Type(() => Number)
  chainId: number;

  @ApiProperty({ example: 'my-voucher-batch' })
  @IsString()
  voucherName: string;
}

export class BuildCreateVoucherDto {
  @ApiProperty({ example: 42220 })
  @IsNumber()
  chainId: number;

  @ApiProperty({
    example: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
    description: 'Token address (0x0 for native)',
  })
  @IsString()
  token: string;

  @ApiProperty({ example: 'my-voucher-batch' })
  @IsString()
  voucherName: string;

  @ApiProperty({
    example: ['0xabc123...', '0xdef456...'],
    description:
      'keccak256(voucherName + claimCode) hashes — computed client-side',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  claimCodeHashes: string[];

  @ApiProperty({
    example: ['10000000000000000000', '5000000000000000000'],
    description: 'Amounts in wei',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  amounts: string[];

  @ApiProperty({
    example: [1800000000, 1800000000],
    description: 'Unix timestamps',
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMinSize(1)
  expirationTimes: number[];
}

export class BuildClaimVoucherDto {
  @ApiProperty({ example: 42220 })
  @IsNumber()
  chainId: number;

  @ApiProperty({
    example: '0xabc123...',
    description: 'keccak256(voucherName + claimCode) — computed client-side',
  })
  @IsString()
  claimCodeHash: string;
}

export class BuildRefundVouchersDto {
  @ApiProperty({ example: 42220 })
  @IsNumber()
  chainId: number;

  @ApiProperty({ example: 'my-voucher-batch' })
  @IsString()
  voucherName: string;
}
