import { SecurityOverview } from "@/components/drive/SecurityWidgets";

export default function SecurityPage() {
  return (
    <section className="px-1 pt-1">
      <h1 className="page-title mb-4">Security Center</h1>
      <SecurityOverview />
    </section>
  );
}
