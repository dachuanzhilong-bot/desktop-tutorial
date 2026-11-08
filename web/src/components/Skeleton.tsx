export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function GridSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="grid13">
      {Array.from({ length: 169 }, (_, i) => (
        <div key={i} className="skeleton aspect-square" style={{ animationDelay: `${(i % 13) * 40}ms` }} />
      ))}
    </div>
  );
}
