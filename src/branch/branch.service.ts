import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { BranchName, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchService {
  constructor(private prisma: PrismaService) {}

  async create(name: BranchName, subjects: string[]) {
    const existing = await this.prisma.branch.findUnique({
      where: { name },
    });
    if (existing) {
      throw new ConflictException('Branch with this name already exists');
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
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  async selectBranch(userId: string, branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        if (!user) throw new NotFoundException('User not found');
        throw new BadRequestException(
          'Branch already selected. Use change endpoint instead.',
        );
      }
      throw error;
    }
  }

  async changeBranch(userId: string, branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        if (!user) throw new NotFoundException('User not found');
        if (!user.branchId) {
          throw new BadRequestException(
            'No branch selected. Use select endpoint instead.',
          );
        }
        throw new BadRequestException('Already assigned to this branch');
      }
      throw error;
    }
  }
}
