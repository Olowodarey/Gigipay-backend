import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyMessage } from 'viem';
import type { Address } from 'viem';
import { UsersService } from '../users/users.service';
import { PrivyLoginDto } from './dto/auth.dto';

const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

@Injectable()
export class AuthService {
  constructor(
    private jwt: JwtService,
    private users: UsersService,
  ) {}

  generateNonce(address: string): string {
    const nonce = Math.random().toString(36).substring(2, 15);
    nonceStore.set(address.toLowerCase(), {
      nonce,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return nonce;
  }

  async verifySignature(
    address: string,
    signature: string,
    message: string,
    isMiniPay = false,
  ) {
    const stored = nonceStore.get(address.toLowerCase());

    if (!stored)
      throw new UnauthorizedException('No nonce found. Request a new one.');
    if (Date.now() > stored.expiresAt) {
      nonceStore.delete(address.toLowerCase());
      throw new UnauthorizedException('Nonce expired. Request a new one.');
    }
    if (!message.includes(stored.nonce)) {
      throw new UnauthorizedException('Invalid nonce in message.');
    }

    const valid = await verifyMessage({
      address: address as Address,
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) throw new UnauthorizedException('Invalid signature.');

    nonceStore.delete(address.toLowerCase());

    const user = await this.users.findOrCreate(address, isMiniPay);
    const token = this.jwt.sign({
      sub: address.toLowerCase(),
      address: address.toLowerCase(),
    });

    return { token, user };
  }

  async privyLogin(dto: PrivyLoginDto) {
    const user = await this.users.upsert({
      address: dto.walletAddress,
      email: dto.email,
      phone: dto.phone,
      privyUserId: dto.privyUserId,
    });

    const token = this.jwt.sign({
      sub: dto.walletAddress.toLowerCase(),
      address: dto.walletAddress.toLowerCase(),
      privyUserId: dto.privyUserId,
    });

    return { token, user };
  }
}
