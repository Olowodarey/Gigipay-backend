import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class RecipientDto {
  @ApiProperty({ example: '0x1234...abcd' })
  @IsString()
  address!: string;

  @ApiProperty({ example: '5', description: 'Amount in human token units' })
  @IsString()
  amount!: string;
}

export class CreateScheduleDto {
  @ApiProperty({ enum: ['airtime', 'batch-transfer'] })
  @IsIn(['airtime', 'batch-transfer'])
  kind!: 'airtime' | 'batch-transfer';

  @ApiProperty({ example: 42220, required: false })
  @IsOptional()
  @IsInt()
  chainId?: number;

  @ApiProperty({ example: 'USDC' })
  @IsString()
  tokenSymbol!: string;

  @ApiProperty({ enum: ['daily', 'weekly', 'monthly'] })
  @IsIn(['daily', 'weekly', 'monthly'])
  cadence!: 'daily' | 'weekly' | 'monthly';

  @ApiProperty({
    required: false,
    description: 'When the first run should fire (ISO). Defaults to now.',
  })
  @IsOptional()
  @IsString()
  startAt?: string;

  @ApiProperty({ required: false, description: 'Hard stop (ISO). Optional.' })
  @IsOptional()
  @IsString()
  endAt?: string;

  @ApiProperty({ required: false, example: 20, description: 'Per-run USD cap' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  spendCapUsd?: number;

  @ApiProperty({ required: false, example: 'Airtime for Mum' })
  @IsOptional()
  @IsString()
  label?: string;

  // ── airtime params ──
  @ApiProperty({ required: false, example: '08012345678' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ required: false, example: 1000, description: 'Airtime NGN value' })
  @IsOptional()
  @IsNumber()
  amountNgn?: number;

  @ApiProperty({ required: false, enum: ['MTN', 'GLO', 'AIRTEL', '9MOBILE'] })
  @IsOptional()
  @IsString()
  network?: string;

  // ── batch-transfer params ──
  @ApiProperty({ required: false, type: [RecipientDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  recipients?: RecipientDto[];
}
