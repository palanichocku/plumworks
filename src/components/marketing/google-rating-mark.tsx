/** Informational rating display. A figure must be explicitly configured and validated.
 * Do not infer a rating from individual review stars or use this as structured-data markup.
 */
export function GoogleRatingMark({ rating }: { rating: number }) {
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;
  return <span className="inline-flex items-center gap-2" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
    <span className="text-2xl font-black tabular-nums text-white">{rating.toFixed(1)}<span className="ml-1 text-sm font-bold text-slate-300">/ 5</span></span>
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => <span key={index} className="relative inline-block text-xl leading-none">
        <span className="text-slate-500">★</span>
        <span className="absolute inset-0 overflow-hidden whitespace-nowrap text-amber-400" style={{ width: `${Math.max(0, Math.min(1, rating - index)) * 100}%` }}>★</span>
      </span>)}
    </span>
  </span>;
}
