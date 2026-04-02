import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEthereumAddress } from 'class-validator';

export class GetNonceDto {
  @ApiProperty({ example: '0xabc...' })
  @IsString()
  address: string;
}

export class VerifySignatureDto {
  @ApiProperty({ example: '0xabc...' })
  @IsString()
  address: string;

  @ApiProperty({ example: '0xsignature...' })
  @IsString()
  signature: string;

  @ApiProperty({ example: 'Sign in to Gigipay: nonce=abc123' })
  @IsString()
  message: string;
}
