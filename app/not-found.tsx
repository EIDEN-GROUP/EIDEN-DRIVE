export default function NotFound() {
  return (
    <section className="card bg-white p-6 max-w-lg mx-auto text-center">
      <h1 className="font-display text-3xl uppercase">Nothing here</h1>
      <p className="text-sm mt-2 font-serif italic">That file or page moved. Search the drive or head back.</p>
      <a href="/drive" className="mt-4 inline-block min-h-[44px] px-5 leading-[44px] rounded-2xl bg-teal-600 text-cream-50 font-semibold">Back to Drive</a>
    </section>
  );
}
