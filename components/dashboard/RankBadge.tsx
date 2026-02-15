interface RankBadgeProps {
  rank: number | null;
}

export default function RankBadge({ rank }: RankBadgeProps) {
  if (rank === null) {
    return (
      <span className="inline-flex items-center justify-center px-3 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-400">
        순위권 외
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
