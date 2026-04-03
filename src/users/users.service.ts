import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import { UpsertUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private repo: Repository<UserEntity>,
  ) {}

  async upsert(dto: UpsertUserDto): Promise<UserEntity> {
    const key = dto.address.toLowerCase();
    const existing = await this.repo.findOne({ where: { address: key } });

    const user = this.repo.create({
      ...existing,
      address: key,
      email: dto.email ?? existing?.email,
      phone: dto.phone ?? existing?.phone,
      displayName: dto.displayName ?? existing?.displayName,
      isMiniPay: dto.isMiniPay ?? existing?.isMiniPay ?? false,
      privyUserId: dto.privyUserId ?? existing?.privyUserId,
    });

    return this.repo.save(user);
  }

  async findOrCreate(address: string, isMiniPay = false): Promise<UserEntity> {
    const key = address.toLowerCase();
    const existing = await this.repo.findOne({ where: { address: key } });
    if (existing) return existing;

    const user = this.repo.create({ address: key, isMiniPay });
    return this.repo.save(user);
  }

  async findByAddress(address: string): Promise<UserEntity> {
    const user = await this.repo.findOne({
      where: { address: address.toLowerCase() },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async linkPrivy(address: string, privyUserId: string): Promise<UserEntity> {
    const user = await this.findOrCreate(address);
    user.privyUserId = privyUserId;
    return this.repo.save(user);
  }
}
