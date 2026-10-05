import { SecurityOverview } from "@/components/drive/SecurityWidgets";

export default function SecurityPage() {
  return (
    <section>
      <h1 className="font-display text-3xl uppercase mb-3">Security Center</h1>
      <SecurityOverview />
    </section>
  );
}
