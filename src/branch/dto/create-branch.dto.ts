import { IsString, IsArray, IsEnum, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BranchName } from '@prisma/client';

export class CreateBranchDto {
  @ApiProperty({ enum: BranchName, description: 'Academic branch name' })
  @IsEnum(BranchName)
  name: BranchName;

  @ApiProperty({
    type: [String],
    description: 'List of subject names',
    minItems: 1,
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  subjects: string[];
}
