interface RankChangeProps {
  current: number | null;
  previous: number | null;
}

export default function RankChange({ current, previous }: RankChangeProps) {
  if (previous === null && current === null) {
    return <span className="text-slate-300 text-xs">-</span>;
  }

  if (previous === null && current !== null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-500 text-xs font-medium">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
        </svg>
        NEW
      </span>
    );
  }

  if (previous !== null && current === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-400 text-xs font-medium">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
        OUT
      </span>
    );
  }

  if (current === null || previous === null) {
    return <span className="text-slate-300 text-xs">-</span>;
  }

  const diff = previous - current;

  if (diff === 0) {
    return <span className="text-slate-400 text-xs font-medium">-</span>;
  }

  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-500 text-xs font-bold">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
        </svg>
        +{diff}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 text-red-400 text-xs font-bold">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
      {diff}
    </span>
  );
}
