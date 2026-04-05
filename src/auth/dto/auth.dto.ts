import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean } from 'class-validator';

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

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isMiniPay?: boolean;
}

export class PrivyLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJFUzI1NiJ9...',
    description: 'Privy access token obtained from the frontend SDK',
  })
  @IsString()
  accessToken: string;
}
