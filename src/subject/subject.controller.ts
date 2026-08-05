import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SubjectService } from './subject.service';
import { CurrentUser, Public } from '../common';
import type { User } from '@prisma/client';

@ApiTags('Subjects')
@Controller('subjects')
export class SubjectController {
  constructor(private subjectService: SubjectService) {}

  @ApiBearerAuth('access-token')
  @Get()
  @ApiOperation({ summary: "Get subjects for the current user's branch" })
  @ApiResponse({
    status: 200,
    description: 'List of subjects for the selected branch',
  })
  @ApiResponse({ status: 404, description: 'User has no branch selected' })
  async getMySubjects(@CurrentUser() user: User) {
    return this.subjectService.getByUserBranch(user.id);
  }

  @Public()
  @Get('branch/:branchId')
  @ApiOperation({ summary: 'Get subjects by branch ID (public)' })
  @ApiResponse({
    status: 200,
    description: 'List of subjects for the branch',
  })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async getByBranch(@Param('branchId') branchId: string) {
    return this.subjectService.getByBranch(branchId);
  }
}
