interface RankBadgeProps {
  rank: number | null;
  smartBlockName?: string | null;
  smartBlockRank?: number | null;
  isReply?: boolean;
  replySince?: string | null;
  noRankLabel?: string;
}

function replyDays(replySince: string | null | undefined): number {
  if (!replySince) return 1;
  const diff = Date.now() - new Date(replySince).getTime();
  return Math.max(1, Math.ceil(diff / 86400000));
}

export default function RankBadge({
  rank,
  smartBlockName,
  smartBlockRank,
  isReply,
  replySince,
  noRankLabel = "순위권 외",
}: RankBadgeProps) {
  // 꼬리글 상태 - 미노출이지만 꼬리글에 노출됨
  if (isReply) {
    const days = replyDays(replySince);
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-semibold bg-orange-100 text-orange-700 whitespace-nowrap">
          꼬리글 {days}일차
        </span>
      </div>
    );
  }

  // 꼬리글탈출 - 이전에 꼬리글이었는데 지금은 VIEW/스마트블록에 진입
  const escaped = !isReply && replySince && (rank !== null || (smartBlockName && smartBlockRank));

  // 스마트블록에 노출된 경우 - 블록명과 블록 내 순위 표시
  if (smartBlockName && smartBlockRank) {
    const shortName = smartBlockName.replace(/^'[^']*'\s*/, "").trim() || smartBlockName;

    return (
      <div className="flex flex-col items-center gap-1">
        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-semibold bg-violet-100 text-violet-700 whitespace-nowrap">
          {shortName}
        </span>
        <span className="inline-flex items-center justify-center min-w-[44px] px-3 py-1 rounded-lg text-sm font-bold bg-violet-50 text-violet-600">
          {smartBlockRank}위
        </span>
        {escaped && (
          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-bold bg-green-100 text-green-700 whitespace-nowrap">
            꼬리글탈출
          </span>
        )}
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
    <div className="flex flex-col items-center gap-1">
      <span
        className={`inline-flex items-center justify-center min-w-[44px] px-3 py-1 rounded-lg text-sm font-bold ${colorClass}`}
      >
        {rank}위
      </span>
      {escaped && (
        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-bold bg-green-100 text-green-700 whitespace-nowrap">
          꼬리글탈출
        </span>
      )}
    </div>
  );
}
