import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { branch: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { passwordHash: _, ...rest } = user;
    return rest;
  }
}
