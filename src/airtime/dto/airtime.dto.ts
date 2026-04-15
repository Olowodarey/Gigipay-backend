import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export const MOBILE_NETWORKS = {
  MTN: '01',
  GLO: '02',
  '9MOBILE': '03',
  AIRTEL: '04',
} as const;

export type MobileNetworkCode =
  (typeof MOBILE_NETWORKS)[keyof typeof MOBILE_NETWORKS];

/** Build a payBill transaction for the frontend to sign */
export class BuildAirtimePayBillDto {
  @ApiProperty({
    example: 42220,
    description: 'Chain ID (42220=Celo, 8453=Base)',
  })
  @IsNumber()
  @Type(() => Number)
  chainId: number;

  @ApiProperty({
    example: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
    description: 'ERC20 token address, or 0x0000...0000 for native',
  })
  @IsString()
  token: string;

  @ApiProperty({
    example: '100000000000000000000',
    description: 'Amount in token smallest unit',
  })
  @IsString()
  amount: string;

  @ApiProperty({
    example: '01',
    description: 'Network code: 01=MTN, 02=GLO, 03=9mobile, 04=Airtel',
  })
  @IsString()
  @IsIn(Object.values(MOBILE_NETWORKS))
  networkCode: MobileNetworkCode;

  @ApiProperty({
    example: '08012345678',
    description: 'Recipient phone number',
  })
  @IsString()
  phoneNumber: string;
}

/** Manually trigger airtime purchase (admin/internal use) */
export class BuyAirtimeDto {
  @ApiProperty({
    example: '01',
    description: 'Network code: 01=MTN, 02=GLO, 03=9mobile, 04=Airtel',
  })
  @IsString()
  @IsIn(Object.values(MOBILE_NETWORKS))
  networkCode: MobileNetworkCode;

  @ApiProperty({
    example: 100,
    description: 'Amount in NGN (min 50, max 200000)',
  })
  @IsNumber()
  @Min(50)
  @Max(200000)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ example: '08012345678' })
  @IsString()
  phoneNumber: string;

  @ApiPropertyOptional({
    example: 'req_abc123',
    description: 'Unique request ID for idempotency',
  })
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiPropertyOptional({
    example: '03',
    description: 'Bonus type e.g. 03 = MTN GistPlus',
  })
  @IsOptional()
  @IsString()
  bonusType?: string;
}

/** Query a transaction by orderId or requestId */
export class QueryAirtimeDto {
  @ApiPropertyOptional({ example: '6501321715' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ example: 'req_abc123' })
  @IsOptional()
  @IsString()
  requestId?: string;
}

/** Cancel a transaction by orderId */
export class CancelAirtimeDto {
  @ApiProperty({ example: '6501321715' })
  @IsString()
  orderId: string;
}

/** Available networks response item */
export interface NetworkDiscount {
  networkCode: string;
  networkName: string;
  discountPercent: number;
}
