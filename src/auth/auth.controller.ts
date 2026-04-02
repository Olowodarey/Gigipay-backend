import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { GetNonceDto, VerifySignatureDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Get('nonce')
  @ApiOperation({ summary: 'Get a sign-in nonce for a wallet address' })
  getNonce(@Query() dto: GetNonceDto) {
    const nonce = this.service.generateNonce(dto.address);
    return {
      nonce,
      message: `Sign in to Gigipay: nonce=${nonce}`,
    };
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify wallet signature and get JWT token' })
  async verify(@Body() dto: VerifySignatureDto) {
    const token = await this.service.verifySignature(
      dto.address,
      dto.signature,
      dto.message,
    );
    return { token, address: dto.address.toLowerCase() };
  }
}
