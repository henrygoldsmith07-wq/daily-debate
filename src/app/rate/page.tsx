import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import RateForm from "@/components/RateForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Rate debates" };

export default function RatePage() {
  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Human evaluation"
        title="Blind-rate a debate"
        description="Your ratings build the human-labelled corpus that judge validity is measured against. Human agreement comes first — every item needs at least two independent raters before it counts."
      />
      <RateForm />
    </AppShell>
  );
}
