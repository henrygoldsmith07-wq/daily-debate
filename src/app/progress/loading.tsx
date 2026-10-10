import { Skeleton } from "@/components/Skeleton";

/**
 * Progress-screen loading shape.
 *
 * The root `app/loading.tsx` applies to every route segment, so without a
 * nested file a slow `/progress` renders the generic two-card stack — which
 * resembles neither the Today screen nor the Progress screen it is loading.
 * A nested `loading.tsx` replaces the root placeholder only for this segment.
 */
export default function ProgressLoading() {
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
            Loading your progress…
          </p>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-40" />
          {/* The seven-skill readout */}
          <Skeleton className="h-64 w-full rounded-xl" />
          {/* Coach card, which loads its own state client-side */}
          <Skeleton className="h-48 w-full rounded-xl" />
          {/* The remaining analysis sections */}
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
