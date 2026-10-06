"use client";
import { useRouter } from "next/navigation";
import Logo from "./Logo";

export const HTTP_ERRORS: Record<string, { title: string; body: string }> = {
  "400": { title: "Bad request", body: "Something in that request was malformed. Go back and try again — if it repeats, tell a manager what you clicked." },
  "401": { title: "Sign in needed", body: "Your session expired or you aren't signed in. Sign in and retry." },
  "403": { title: "Not allowed", body: "Your account doesn't have permission for that. Managers can grant access." },
  "404": { title: "Lost in the drive?", body: "That file or page moved, was trashed, or never existed." },
  "405": { title: "Wrong method", body: "That address doesn't accept this kind of request. This is usually a wiring bug — tell a manager." },
  "408": { title: "Timed out", body: "The request took too long. Check your connection and retry." },
  "409": { title: "Already exists", body: "That was already created — for example, the email is already invited." },
  "410": { title: "Gone", body: "That item was permanently removed (for example, the Recovery Bin purged it after 90 days)." },
  "413": { title: "Too large", body: "That file exceeds the 100 MB upload limit. Compress it or split it and retry." },
  "415": { title: "Unsupported type", body: "That file type isn't accepted here." },
  "422": { title: "Couldn't save", body: "A field failed validation. Fix the highlighted field and retry." },
  "429": { title: "Too many tries", body: "Slow down — wait a minute, then try exactly once." },
  "500": { title: "Something broke", body: "The team has the full trace in the server logs. Nothing was deleted." },
  "501": { title: "Not built yet", body: "That action isn't implemented. Tell a manager what you needed." },
  "502": { title: "Google hiccup", body: "Google Drive didn't answer. Your files are safe — retry in a bit." },
  "503": { title: "Not connected", body: "A backend isn't configured yet (Google token, storage bucket, or agent). Managers: open /api/health." },
  "504": { title: "No answer", body: "The server didn't answer in time. Check your connection and retry." }
};

// One branded error surface for every HTTP/technical failure: code, plain-language
// recovery step, search (404), and a way back. Used by not-found, error boundaries,
// and anywhere an API status needs a human sentence.
export default function HttpError({ code, detail, onRetry }: { code: keyof typeof HTTP_ERRORS | string; detail?: string; onRetry?: () => void }) {
  const router = useRouter();
  const e = HTTP_ERRORS[code] ?? HTTP_ERRORS["500"];
  return (
    <section className="card p-8 max-w-lg mx-auto text-center" role="alert">
      <div className="mx-auto w-fit"><Logo size={48} /></div>
      <p className="mt-4 text-[12px] font-bold tracking-[.22em] text-muted">{code} · {e.title.toUpperCase()}</p>
      <p className="text-sm mt-2 text-muted">{e.body}</p>
      {detail && <p className="text-xs mt-2 text-muted break-all">{detail}</p>}
      {code === "404" && <NotFoundSearch />}
      <div className="mt-4 flex justify-center gap-3 flex-wrap">
        {onRetry && (
          <button onClick={onRetry} className="min-h-[44px] px-5 rounded-md bg-brand text-white font-medium text-sm">Try again</button>
        )}
        <a href="/drive" className="min-h-[44px] px-5 inline-flex items-center rounded-md bg-brand text-white font-medium text-sm">Back to Drive</a>
        {(code === "401" || code === "403") && (
          <a href="/login" className="min-h-[44px] px-5 inline-flex items-center rounded-md border border-line text-sm">Sign in</a>
        )}
      </div>
    </section>
  );
}

export function NotFoundSearch() {
  const router = useRouter();
  return (
    <form
      className="mt-4 flex gap-2 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        const v = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value;
        router.push(`/drive?q=${encodeURIComponent(v)}`);
      }}>
      <label htmlFor="http-err-search" className="sr-only">Search files</label>
      <input id="http-err-search" name="q" placeholder="Search files…"
        className="flex-1 min-h-[44px] px-4 rounded-md border border-line bg-surface text-sm" />
      <button className="min-h-[44px] px-5 rounded-md bg-brand text-white text-sm font-medium">Search</button>
    </form>
  );
}
