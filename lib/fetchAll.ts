// Supabase는 한 번에 최대 1000행만 돌려준다. 끝까지 읽어 합친다.
// page(from, to)는 .range(from, to)를 적용한 쿼리를 실행해 { data, error }를 돌려주는 함수.

const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: string | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: all, error: error.message };
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { data: all, error: null };
}
