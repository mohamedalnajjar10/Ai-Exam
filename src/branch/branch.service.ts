import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { BranchName, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Maps a Prisma P2025 error (record not found on update) to a business
 * exception based on the user's current state.
 */
function throwIfNotfound(
  error: unknown,
  user: { branchId: string | null } | null,
  selectMessage: string,
  changeMessage: string,
): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  ) {
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    if (!user.branchId) throw new BadRequestException(selectMessage);
    throw new BadRequestException(changeMessage);
  }
  throw error;
}

@Injectable()
export class BranchService {
  constructor(private prisma: PrismaService) {}

  async create(name: BranchName, subjects: string[]) {
    const existing = await this.prisma.branch.findUnique({
      where: { name },
    });
    if (existing) {
      throw new ConflictException('شعبة بهذا الاسم موجودة بالفعل');
    }

    return this.prisma.branch.create({
      data: {
        name,
        subjects: {
          create: subjects.map((subjectName) => ({ name: subjectName })),
        },
      },
      include: { subjects: { orderBy: { name: 'asc' } } },
    });
  }

  async getAll() {
    return this.prisma.branch.findMany({
      include: { _count: { select: { subjects: true } } },
    });
  }

  async getOne(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      include: { subjects: { orderBy: { name: 'asc' } } },
    });
    if (!branch) {
      throw new NotFoundException('الشعبة غير موجودة');
    }
    return branch;
  }

  async selectBranch(userId: string, branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException('الشعبة غير موجودة');
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId, branchId: null },
        data: { branchId },
        include: {
          branch: { include: { subjects: { orderBy: { name: 'asc' } } } },
        },
      });
    } catch (error) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      throwIfNotfound(
        error,
        user,
        'تم اختيار الشعبة بالفعل. استخدم نقطة التغيير بدلاً من ذلك.',
        'تم اختيار الشعبة بالفعل. استخدم نقطة التغيير بدلاً من ذلك.',
      );
    }
  }

  async changeBranch(userId: string, branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException('الشعبة غير موجودة');
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId, branchId: { not: null }, NOT: { branchId } },
        data: { branchId },
        include: {
          branch: { include: { subjects: { orderBy: { name: 'asc' } } } },
        },
      });
    } catch (error) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      throwIfNotfound(
        error,
        user,
        'لم يتم اختيار أي شعبة. استخدم نقطة الاختيار بدلاً من ذلك.',
        'أنت منضم إلى هذه الشعبة بالفعل',
      );
    }
  }
}
