import { IsArray, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';
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
