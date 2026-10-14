import { describe, expect, it } from "vitest";
import { readSupaOff, writeSupaOff, shouldUploadViaGoogle, usbAllowed } from "@/lib/storage-prefs";

// Supabase Storage is OFF unless explicitly opted in: fresh installs,
// missing keys, "0", and garbage all mean disabled. Only an exact "1"
// enables it, and the choice round-trips (reload survival).

function store(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
  } as Storage;
}

describe("supabase storage preference", () => {
  it("fresh installs default to disabled", () => {
    expect(readSupaOff(store())).toBe(true);
  });

  it("missing or \"0\" never enables", () => {
    expect(readSupaOff(store({}))).toBe(true);
    expect(readSupaOff(store({ "eiden-supabase": "0" }))).toBe(true);
    expect(readSupaOff(store({ "eiden-supabase": "" }))).toBe(true);
    expect(readSupaOff(store({ "eiden-supabase": "true" }))).toBe(true);
  });

  it("an explicit \"1\" is respected", () => {
    expect(readSupaOff(store({ "eiden-supabase": "1" }))).toBe(false);
  });

  it("toggling persists and survives reloads (no silent migration)", () => {
    const s = store();
    expect(readSupaOff(s)).toBe(true); // fresh → off
    writeSupaOff(s, false); // user enables
    expect(readSupaOff(s)).toBe(false);
    writeSupaOff(s, true); // user disables again
    expect(readSupaOff(s)).toBe(true);
    expect(s.getItem("eiden-supabase")).toBe("0");
  });

  it("a throwing store fails closed (disabled)", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } as unknown as Storage;
    expect(readSupaOff(broken)).toBe(true);
    expect(() => writeSupaOff(broken, false)).not.toThrow();
  });
});

describe("upload routing", () => {
  const MAX = 50 * 1024 * 1024;
  it("supabase-off uploads go straight to Google at every size (zero Storage bytes)", () => {
    expect(shouldUploadViaGoogle(true, 1024, MAX)).toBe(true);
    expect(shouldUploadViaGoogle(true, 2 * 1024 * 1024 * 1024, MAX)).toBe(true);
  });

  it("supabase-on uploads use Storage except over the object cap", () => {
    expect(shouldUploadViaGoogle(false, 1024, MAX)).toBe(false);
    expect(shouldUploadViaGoogle(false, MAX + 1, MAX)).toBe(true);
  });

  it("USB copy mode is unavailable while Supabase is off", () => {
    expect(usbAllowed(true)).toBe(false);
    expect(usbAllowed(false)).toBe(true);
  });
});
