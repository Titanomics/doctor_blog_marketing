interface RankBadgeProps {
  rank: number | null;
  smartBlockName?: string | null;
  smartBlockRank?: number | null;
  noRankLabel?: string;
}

export default function RankBadge({
  rank,
  smartBlockName,
  smartBlockRank,
  noRankLabel = "순위권 외",
}: RankBadgeProps) {
  // 스마트블록에 노출된 경우 - 블록명과 블록 내 순위 표시
  if (smartBlockName && smartBlockRank) {
    // 블록명에서 따옴표로 감싼 키워드 부분 제거하여 짧게 표시
    // 예: "'대구심장내과' 인기글" → "인기글"
    const shortName = smartBlockName.replace(/^'[^']*'\s*/, "").trim() || smartBlockName;

    return (
      <div className="flex flex-col items-center gap-1">
        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-semibold bg-violet-100 text-violet-700 whitespace-nowrap">
          {shortName}
        </span>
        <span className="inline-flex items-center justify-center min-w-[44px] px-3 py-1 rounded-lg text-sm font-bold bg-violet-50 text-violet-600">
          {smartBlockRank}위
        </span>
      </div>
    );
  }

  // 일반 VIEW 순위
  if (rank === null) {
    return (
      <span className="inline-flex items-center justify-center px-3 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-400">
        {noRankLabel}
      </span>
    );
  }

  const colorClass =
    rank <= 3
      ? "bg-amber-100 text-amber-700"
      : rank <= 10
        ? "bg-emerald-100 text-emerald-700"
        : rank <= 20
          ? "bg-blue-50 text-blue-600"
          : "bg-slate-100 text-slate-600";

  return (
    <span
      className={`inline-flex items-center justify-center min-w-[44px] px-3 py-1 rounded-lg text-sm font-bold ${colorClass}`}
    >
      {rank}위
    </span>
  );
}
