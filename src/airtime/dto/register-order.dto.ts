import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsIn,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MOBILE_NETWORKS, type MobileNetworkCode } from './airtime.dto';

export class RegisterAirtimeOrderDto {
  @ApiProperty({ example: 42220 })
  @IsNumber()
  @Type(() => Number)
  chainId: number;

  @ApiProperty({ example: '01' })
  @IsString()
  @IsIn(Object.values(MOBILE_NETWORKS))
  networkCode: MobileNetworkCode;

  @ApiProperty({ example: '08012345678' })
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(50)
  @Max(200000)
  @Type(() => Number)
  amountNgn: number;

  @ApiProperty({ example: '0xabc123...' })
  @IsString()
  txHash: string;

  @ApiPropertyOptional({ example: '789' })
  @IsOptional()
  @IsString()
  chainOrderId?: string;
}
