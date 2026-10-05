// 발행 묶음(발행 주)별 현황. 글이 묶음으로 발행되는 경우가 많아
// "발행 후 몇 주차인가"와 "어느 묶음인가"를 함께 봐야 비교가 된다.
//
// 집계 단위는 고유 글이다. 같은 글이 여러 키워드에 등록돼 있어도 한 번만 센다.
//   글 노출 = 연결된 키워드 중 하나 이상이 지금 노출 중
//   글 삭제 = 연결된 키워드가 전부 삭제 표시

import { publishWeekStart } from "@/lib/ageBand";

export interface CohortInput {
  postKey: string; // 고유 글 식별자
  publishedDate: string | null; // KST. 모르면 null → "발행일 미상" 묶음
  exposed: boolean; // 이 키워드가 지금 노출 중
  deleted: boolean;
  firstExposureWeek: number | null;
}

export interface Cohort {
  weekStart: string | null; // 발행 주의 월요일. null = 발행일 미상
  week: number | null; // 그 묶음이 지금 몇 주차인지 (주 시작일 기준)
  posts: number;
  exposed: number;
  unexposed: number;
  deleted: number;
  lateFirst: number; // 2주차 이후에 처음 노출된 글
}

const DAY_MS = 86_400_000;

export function buildCohorts(inputs: CohortInput[], today: string): Cohort[] {
  const posts = new Map<string, { date: string | null; exposed: boolean; allDeleted: boolean; firstWeek: number | null }>();
  for (const r of inputs) {
    const p = posts.get(r.postKey);
    if (!p) {
      posts.set(r.postKey, { date: r.publishedDate, exposed: r.exposed, allDeleted: r.deleted, firstWeek: r.firstExposureWeek });
    } else {
      p.exposed = p.exposed || r.exposed;
      p.allDeleted = p.allDeleted && r.deleted;
      p.date ??= r.publishedDate;
      if (r.firstExposureWeek !== null) p.firstWeek = p.firstWeek === null ? r.firstExposureWeek : Math.min(p.firstWeek, r.firstExposureWeek);
    }
  }

  const byWeek = new Map<string, Cohort>();
  for (const p of posts.values()) {
    const weekStart = p.date ? publishWeekStart(p.date) : null;
    const key = weekStart ?? "unknown";
    let c = byWeek.get(key);
    if (!c) {
      const week = weekStart
        ? Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${weekStart}T00:00:00Z`).getTime()) / DAY_MS / 7) + 1
        : null;
      c = { weekStart, week, posts: 0, exposed: 0, unexposed: 0, deleted: 0, lateFirst: 0 };
      byWeek.set(key, c);
    }
    c.posts++;
    if (p.allDeleted) c.deleted++;
    else if (p.exposed) c.exposed++;
    else c.unexposed++;
    if (p.firstWeek !== null && p.firstWeek >= 2) c.lateFirst++;
  }

  // 최근 발행 묶음이 위로, 발행일 미상은 맨 아래
  return [...byWeek.values()].sort((a, b) =>
    a.weekStart === null ? 1 : b.weekStart === null ? -1 : a.weekStart < b.weekStart ? 1 : -1
  );
}
