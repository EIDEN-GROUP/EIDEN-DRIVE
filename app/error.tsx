"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card bg-white p-6 max-w-lg mx-auto text-center" role="alert">
      <h1 className="font-display text-3xl uppercase">Something broke</h1>
      <p className="text-sm mt-2 font-serif italic">The team has the full trace in Vercel logs{error.digest ? ` (ref ${error.digest})` : ""}. Nothing was deleted.</p>
      <button onClick={reset} className="mt-4 min-h-[44px] px-5 rounded-2xl bg-teal-600 text-cream-50 font-semibold">Try again</button>
    </section>
  );
}
