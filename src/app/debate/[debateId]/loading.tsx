import { Skeleton } from "@/components/Skeleton";

/**
 * Debate-room loading shape.
 *
 * The debate room is the screen users spend the most time on, and it streams a
 * full transcript plus a re-derived result snapshot. The root placeholder shows
 * the home screen's card stack, which makes the transition read as a jump to a
 * different product.
 */
export default function DebateLoading() {
  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-hidden="true">
        <div className="app-sidebar-head">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="app-sidebar-nav">
          {[4, 4, 3].map((count, group) => (
            <div key={group} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              {Array.from({ length: count }, (_, row) => (
                <Skeleton key={row} className="h-7 w-full rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-20" />
        </header>
        <div className="app-content">
          <p className="sr-only" role="status">
            Loading the debate…
          </p>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-64" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-2 w-32 rounded-full" />
          </div>
          {/* Transcript surface */}
          <Skeleton className="h-80 w-full rounded-xl" />
          {/* Composer */}
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
