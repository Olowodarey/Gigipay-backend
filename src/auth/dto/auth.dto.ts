import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsEmail } from 'class-validator';

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
  @ApiProperty({ example: 'did:privy:abc123' })
  @IsString()
  privyUserId: string;

  @ApiProperty({ example: '0xabc...' })
  @IsString()
  walletAddress: string;

  @ApiPropertyOptional({ example: '[email protected]' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  phone?: string;
}
