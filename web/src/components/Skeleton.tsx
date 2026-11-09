export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** placeholder of the 13x13 chart: one element (a background pattern draws the cells) instead of 169 */
export function GridSkeleton() {
  return <div role="status" aria-label="Loading" className="skeleton grid-skeleton" />;
}
