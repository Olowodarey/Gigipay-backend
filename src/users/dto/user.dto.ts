import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsBoolean } from 'class-validator';

export class UpsertUserDto {
  @ApiProperty({ example: '0xabc...' })
  @IsString()
  address: string;

  @ApiPropertyOptional({ example: '[email protected]' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Alice' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isMiniPay?: boolean;

  @ApiPropertyOptional({ example: 'did:privy:abc123' })
  @IsOptional()
  @IsString()
  privyUserId?: string;
}
