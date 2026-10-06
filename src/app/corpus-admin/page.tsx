import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import CorpusAdmin from "@/components/CorpusAdmin";
import { getRequestAuthContext } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Corpus admin" };

export default async function CorpusAdminPage() {
  const auth = await getRequestAuthContext();
  if (!auth.isAdmin) {
    return (
      <AppShell width="narrow">
        <PageHeader
          eyebrow="Human evaluation"
          title="Corpus admin"
          description="This console is restricted to corpus administrators."
        />
      </AppShell>
    );
  }

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Human evaluation"
        title="Corpus admin"
        description={
          <>
            Track population progress against the benchmark target, adjudicate items where blind raters
            disagree, and run the judge-vs-human comparison over agreement-ready debates. Raters can be
            recruited to{" "}
            <Link href="/rate" className="text-[var(--accent)] hover:underline">
              /rate
            </Link>
            . Internal product metrics live in the{" "}
            <Link href="/analytics" className="text-[var(--accent)] hover:underline">
              funnel report
            </Link>
            .
          </>
        }
      />
      <CorpusAdmin />
    </AppShell>
  );
}
