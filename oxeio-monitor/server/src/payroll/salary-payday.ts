/** Salary earned in a month is scheduled for the 5th of the following month. */
export function salaryDueOn(yearMonth: string): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  const dueYear = month === 12 ? year + 1 : year;
  const dueMonth = month === 12 ? 1 : month + 1;
  return `${dueYear}-${String(dueMonth).padStart(2, '0')}-05`;
}
