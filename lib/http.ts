import { timingSafeEqual } from "node:crypto";
import type { ZodTypeAny, z } from "zod";

/** Parse + validate a JSON body. Bad input → 400 (never a 500 from a thrown ZodError). */
export async function parseJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<{ data: z.infer<S>; error?: undefined } | { data?: undefined; error: Response }> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { error: Response.json({ error: "invalid JSON body" }, { status: 400 }) }; }
  const r = schema.safeParse(raw);
  if (!r.success) return { error: Response.json({ error: "invalid request", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 }) };
  return { data: r.data };
}

/** Same for query-string params. */
export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): { data: z.infer<S>; error?: undefined } | { data?: undefined; error: Response } {
  const r = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!r.success) return { error: Response.json({ error: "invalid request", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 }) };
  return { data: r.data };
}

/** Constant-time string compare for bearer tokens / shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Escape LIKE/ILIKE wildcards so user input is matched literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
