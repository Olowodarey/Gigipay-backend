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

export class MiniPayLoginDto {
  @ApiProperty({
    example: '0xabc...',
    description:
      "Connected MiniPay wallet address. MiniPay doesn't support message signing (personal_sign), so inside MiniPay we issue a session bound to the injected wallet address. This is safe for Gigipay because every payment is still signed on-chain by the user in their own wallet — the session only scopes non-custodial data (schedules/profile).",
  })
  @IsString()
  address: string;
}

export class PrivyLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJFUzI1NiJ9...',
    description: 'Privy access token obtained from the frontend SDK',
  })
  @IsString()
  accessToken: string;
}
