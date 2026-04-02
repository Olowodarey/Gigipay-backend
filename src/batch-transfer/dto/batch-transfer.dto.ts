import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsArray, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class RecipientDto {
  @ApiProperty({ example: '0xabc...' })
  @IsString()
  address: string;

  @ApiProperty({ example: '1000000000000000000', description: 'Amount in wei' })
  @IsString()
  amount: string;
}

export class BuildBatchTransferDto {
  @ApiProperty({ example: 42220 })
  @IsNumber()
  chainId: number;

  @ApiProperty({
    example: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
    description: 'Token address (0x0 for native)',
  })
  @IsString()
  token: string;

  @ApiProperty({ type: [RecipientDto] })
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => RecipientDto)
  recipients: RecipientDto[];
}
