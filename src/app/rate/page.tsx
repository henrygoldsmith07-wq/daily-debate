import AppHeader from "@/components/AppHeader";
import RateForm from "@/components/RateForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Rate debates" };

export default function RatePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Human evaluation</p>
          <h1 className="text-2xl font-semibold tracking-tight">Blind-rate a debate</h1>
          <p className="mt-2 text-sm text-ink3">
            Your ratings build the human-labelled corpus that judge validity is measured against. Human agreement comes
            first — every item needs at least two independent raters before it counts.
          </p>
        </div>
        <RateForm />
      </main>
    </div>
  );
}
