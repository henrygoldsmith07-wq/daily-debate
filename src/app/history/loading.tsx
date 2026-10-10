import { Skeleton } from "@/components/Skeleton";

/** History-screen loading shape: two lists of records. */
export default function HistoryLoading() {
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
            Loading your history…
          </p>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
