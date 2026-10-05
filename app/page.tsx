export default function Home() {
  return (
    <section>
      <p className="pill inline-block px-3 py-1 border border-[var(--e-line-strong)]">Eiden Group · FileOS</p>
      <h1 className="font-display text-5xl mt-3">One drive for <em className="font-serif italic font-medium">everything.</em></h1>
      <p className="mt-3 max-w-xl">Google Shared Drives (primary) + Router-USB staging via Local Agent. Safe-delete, full audit, encrypted vault, offline PWA.</p>
      <div className="mt-5 flex gap-2">
        <a href="/drive" className="min-h-[44px] px-5 grid place-items-center rounded-2xl bg-teal-600 text-cream-50">Open Drive</a>
        <a href="/security" className="min-h-[44px] px-5 grid place-items-center rounded-2xl border border-[var(--e-line-strong)]">Security Center</a>
      </div>
    </section>
  );
}
