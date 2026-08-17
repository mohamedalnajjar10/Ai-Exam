import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubjectService {
  constructor(private prisma: PrismaService) {}

  async getByBranch(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException('الشعبة غير موجودة');
    }

    return this.prisma.subject.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  async getByUserBranch(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { branchId: true },
    });

    if (!user || !user.branchId) {
      throw new NotFoundException('المستخدم لم يحدد شعبة');
    }

    return this.getByBranch(user.branchId);
  }
}
