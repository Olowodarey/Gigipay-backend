import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyMessage } from 'viem';
import type { Address } from 'viem';

// In-memory nonce store (replace with Redis/DB in production)
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService) {}

  generateNonce(address: string): string {
    const nonce = Math.random().toString(36).substring(2, 15);
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    nonceStore.set(address.toLowerCase(), { nonce, expiresAt });
    return nonce;
  }

  async verifySignature(
    address: string,
    signature: string,
    message: string,
  ): Promise<string> {
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

    // Clear nonce after use
    nonceStore.delete(address.toLowerCase());

    const token = this.jwt.sign({
      sub: address.toLowerCase(),
      address: address.toLowerCase(),
    });
    return token;
  }

  validateToken(token: string) {
    return this.jwt.verify(token);
  }
}
