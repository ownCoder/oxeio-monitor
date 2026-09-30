import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class RecordSalaryPaymentDto {
  @IsIn(['unpaid', 'partial', 'paid'])
  status!: 'unpaid' | 'partial' | 'paid';

  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/, { message: 'paidAmount must be a non-negative taka amount' })
  paidAmount!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paidOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
