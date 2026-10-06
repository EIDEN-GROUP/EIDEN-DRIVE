"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card p-8 max-w-lg mx-auto text-center" role="alert">
      <h1 className="page-title">Something broke</h1>
      <p className="text-sm mt-2 text-muted">The team has the full trace in Vercel logs{error.digest ? ` (ref ${error.digest})` : ""}. Nothing was deleted.</p>
      <button onClick={reset} className="mt-4 min-h-[44px] px-5 rounded-md bg-brand text-white font-medium text-sm">Try again</button>
    </section>
  );
}
