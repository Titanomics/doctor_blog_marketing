// 순위를 새로 저장할 때 previous_rank(직전 순위)를 어떻게 정할지에 대한 규칙.
//
// previous_rank 는 "지난번 수집일의 순위"다. 같은 날 두 번 이상 수집하면(새벽 배치 뒤 낮에 수동 새로고침 등)
// 두 번째부터 previous_rank := current_rank 로 덮여 "어제 대비 변화"가 사라지는 문제가 있었다.
// 그래서 마지막 갱신이 오늘(KST)이면 previous_rank 를 그대로 두고, 다른 날이면 current_rank 를 넘긴다.

export interface RankRow {
  current_rank: number | null;
  previous_rank: number | null;
  updated_at: string | null;
}

function kstDate(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

export function nextPreviousRank(row: RankRow, nowMs: number = Date.now()): number | null {
  if (!row.updated_at) return row.current_rank;
  const updatedMs = new Date(row.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return row.current_rank;
  return kstDate(updatedMs) === kstDate(nowMs) ? row.previous_rank : row.current_rank;
}
