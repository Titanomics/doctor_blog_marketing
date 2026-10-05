import { NextResponse } from "next/server";
import { loadAgeInfo } from "@/lib/ageData";
import { buildCohorts, type Cohort } from "@/lib/cohorts";
import { loadProductOverview, type ProductSide } from "@/lib/productOverview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/age/cohorts — 발행 묶음(발행 주)별 현황. 카페·블로그기자단, 브랜드별.
// 고유 글 기준. 발행일을 모르는 글은 등록일로 대신하지 않고 "발행일 미상"으로 따로 둔다.
export async function GET() {
  const product = await loadProductOverview([]);
  const [cafeAge, reporterAge] = await Promise.all([
    loadAgeInfo("cafe", product.cafe.rows),
    loadAgeInfo("reporter", product.reporter.rows),
  ]);

  const build = (side: ProductSide, ages: typeof cafeAge.items, brand: string | null): Cohort[] =>
    buildCohorts(
      side.rows
        .filter((r) => brand === null || r.brand === brand)
        .map((r) => {
          const age = ages.get(r.id);
          return {
            postKey: r.postKey,
            publishedDate: age && !age.estimated ? age.publishedDate : null,
            exposed: r.current !== null && !r.reply && !r.deleted,
            deleted: r.deleted,
            firstExposureWeek: age?.lateFirst ? age.firstExposureWeek : null,
          };
        }),
      cafeAge.today
    );

  const cafe: Record<string, Cohort[]> = { 전체: build(product.cafe, cafeAge.items, null) };
  const reporter: Record<string, Cohort[]> = { 전체: build(product.reporter, reporterAge.items, null) };
  for (const brand of product.brands) {
    cafe[brand] = build(product.cafe, cafeAge.items, brand);
    reporter[brand] = build(product.reporter, reporterAge.items, brand);
  }

  return NextResponse.json(
    { today: cafeAge.today, brands: product.brands, cafe, reporter },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
