import {
  Injectable,
  UnauthorizedException,
  OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import { verifyMessage } from 'viem';
import type { Address } from 'viem';
import { UsersService } from '../users/users.service';
import { PrivyLoginDto } from './dto/auth.dto';

const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

@Injectable()
export class AuthService implements OnModuleInit {
  private privy: PrivyClient;

  constructor(
    private jwt: JwtService,
    private users: UsersService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    const appId = this.config.get<string>('privy.appId') ?? '';
    const appSecret = this.config.get<string>('privy.appSecret') ?? '';
    this.privy = new PrivyClient(appId, appSecret);
  }

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
    // Verify the Privy access token server-side
    let privyUser: Awaited<ReturnType<PrivyClient['verifyAuthToken']>>;
    try {
      privyUser = await this.privy.verifyAuthToken(dto.accessToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired Privy token.');
    }

    const privyUserId = privyUser.userId;

    // Extract linked accounts (email, phone, wallet)
    const fullUser = await this.privy.getUser(privyUserId);

    const emailAccount = fullUser.linkedAccounts.find(
      (a) => a.type === 'email',
    ) as { type: 'email'; address: string } | undefined;

    const phoneAccount = fullUser.linkedAccounts.find(
      (a) => a.type === 'phone',
    ) as { type: 'phone'; number: string } | undefined;

    const walletAccount = fullUser.linkedAccounts.find(
      (a) => a.type === 'wallet',
    ) as { type: 'wallet'; address: string } | undefined;

    // Privy embedded wallet address, fallback to a privy-prefixed identifier
    const walletAddress = walletAccount?.address ?? `privy:${privyUserId}`;

    const user = await this.users.upsert({
      address: walletAddress,
      email: emailAccount?.address,
      phone: phoneAccount?.number,
      privyUserId,
    });

    const token = this.jwt.sign({
      sub: walletAddress.toLowerCase(),
      address: walletAddress.toLowerCase(),
      privyUserId,
    });

    return { token, user };
  }
}
