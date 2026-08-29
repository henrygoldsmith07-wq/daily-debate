import { Skeleton } from "@/components/Skeleton";

/**
 * Route-level loading UI. It mirrors the app shell — sidebar rail on desktop,
 * compact bar on mobile — so a streaming page settles into place instead of
 * shifting the whole layout when it arrives.
 */
export default function Loading() {
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
        <div className="app-content max-w-4xl">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
