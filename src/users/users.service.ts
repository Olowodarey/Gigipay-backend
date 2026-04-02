import { Injectable, NotFoundException } from '@nestjs/common';
import { UpsertUserDto } from './dto/user.dto';

// In-memory store — replace with DB (Prisma/TypeORM) later
interface User {
  address: string;
  email?: string;
  phone?: string;
  displayName?: string;
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
      createdAt: existing?.createdAt ?? now,
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
