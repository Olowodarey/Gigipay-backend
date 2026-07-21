import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyMessage } from 'viem';
import type { Address } from 'viem';
import { UsersService } from '../users/users.service';

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

  /**
   * MiniPay session login — no signature. MiniPay does not support
   * `personal_sign`/`eth_signTypedData`, so we cannot run the SIWE flow inside
   * it. Instead we issue a JWT bound to the injected wallet address.
   *
   * Security note: this trusts the client-supplied address, so it is only
   * acceptable because Gigipay is non-custodial — the session never moves funds;
   * every payment is still signed on-chain by the user's own wallet. It only
   * scopes per-user data (schedules, profile). Do NOT reuse this pattern for any
   * flow that could spend or withdraw on the user's behalf.
   */
  async miniPayLogin(address: string) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address))
      throw new UnauthorizedException('Invalid wallet address.');
    const user = await this.users.findOrCreate(address, true);
    const token = this.jwt.sign({
      sub: address.toLowerCase(),
      address: address.toLowerCase(),
    });
    return { token, user };
  }
}
