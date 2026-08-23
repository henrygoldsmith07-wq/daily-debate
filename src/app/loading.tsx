import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[var(--rule)] bg-[var(--panel)] px-4 py-3 sm:px-6">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-6 w-20" />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-10 sm:px-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </main>
    </div>
  );
}
