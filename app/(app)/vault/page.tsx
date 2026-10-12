import { VaultPanel } from "@/components/drive/VaultPanel";

export default function VaultPage() {
  return (
    <section className="px-0 sm:px-1 pt-1 max-w-[1600px] mx-auto">
      <h1 className="page-title mb-4">Vault</h1>
      <VaultPanel />
    </section>
  );
}
