"use client";

function BarChart({
  title,
  bars,
  color = "#2563eb",
}: {
  title: string;
  bars: { label: string; value: number; total?: number }[];
  color?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.total ?? b.value));
  const barHeight = 22;
  const gap = 8;
  const chartHeight = bars.length * (barHeight + gap);
  const labelWidth = 90;
  const chartWidth = 380;

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <svg viewBox={`0 0 ${labelWidth + chartWidth + 50} ${chartHeight}`} width="100%" height={chartHeight}>
        {bars.map((b, i) => {
          const y = i * (barHeight + gap);
          const w = (b.value / max) * chartWidth;
          return (
            <g key={b.label}>
              <text x={labelWidth - 8} y={y + barHeight / 2 + 4} textAnchor="end" fontSize="11" fill="#475569">
                {b.label}
              </text>
              <rect x={labelWidth} y={y} width={chartWidth} height={barHeight} fill="#f1f5f9" rx={4} />
              <rect x={labelWidth} y={y} width={Math.max(2, w)} height={barHeight} fill={color} rx={4} />
              <text x={labelWidth + chartWidth + 8} y={y + barHeight / 2 + 4} fontSize="11" fill="#334155">
                {b.total !== undefined ? `${b.value}/${b.total}` : b.value}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RoomCharts({
  scoreDistribution,
  questionStats,
}: {
  scoreDistribution: { label: string; value: number }[];
  questionStats: { label: string; correct: number; total: number }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <BarChart title="Phân phối điểm" bars={scoreDistribution} color="#2563eb" />
      <BarChart
        title="Tỉ lệ đúng theo câu"
        bars={questionStats.map((q) => ({ label: q.label, value: q.correct, total: q.total }))}
        color="#16a34a"
      />
    </div>
  );
}
