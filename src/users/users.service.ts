import { Injectable, NotFoundException } from '@nestjs/common';
import { UpsertUserDto } from './dto/user.dto';

export interface User {
  address: string;
  email?: string;
  phone?: string;
  displayName?: string;
  isMiniPay: boolean;
  createdAt: string;
  updatedAt: string;
}

const users = new Map<string, User>();

@Injectable()
export class UsersService {
  upsert(dto: UpsertUserDto): User {
    const key = dto.address.toLowerCase();
    const existing = users.get(key);
    const now = new Date().toISOString();

    const user: User = {
      address: key,
      email: dto.email ?? existing?.email,
      phone: dto.phone ?? existing?.phone,
      displayName: dto.displayName ?? existing?.displayName,
      isMiniPay: dto.isMiniPay ?? existing?.isMiniPay ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    users.set(key, user);
    return user;
  }

  findOrCreate(address: string, isMiniPay = false): User {
    const key = address.toLowerCase();
    const existing = users.get(key);
    if (existing) return existing;

    const now = new Date().toISOString();
    const user: User = {
      address: key,
      isMiniPay,
      createdAt: now,
      updatedAt: now,
    };
    users.set(key, user);
    return user;
  }

  findByAddress(address: string): User {
    const user = users.get(address.toLowerCase());
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
