import { ArrayMaxSize, IsArray, IsIn, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SavedViewDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsObject()
  view!: Record<string, unknown>;
}

export class SaveViewsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SavedViewDto)
  views!: SavedViewDto[];
}

export class SaveColumnsDto {
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @IsIn(['design', 'stage', 'file', 'people'], { each: true })
  columns!: string[];
}
