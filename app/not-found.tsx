export default function NotFound() {
  return (
    <section className="card p-8 max-w-lg mx-auto text-center">
      <h1 className="page-title">Nothing here</h1>
      <p className="text-sm mt-2 text-muted">That file or page moved. Search the drive or head back.</p>
      <a href="/drive" className="mt-4 inline-block min-h-[44px] px-5 leading-[44px] rounded-md bg-brand text-white font-medium text-sm">Back to Drive</a>
    </section>
  );
}
