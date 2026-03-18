/** KST(UTC+9) 기준 오늘 날짜를 "YYYY-MM-DD" 형식으로 반환 */
export function getKSTDateString(date: Date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
}

/** KST 기준 어제 날짜를 "YYYY-MM-DD" 형식으로 반환 */
export function getKSTYesterdayString(): string {
  return getKSTDateString(new Date(Date.now() - 86400000));
}
