// Supabase-Storage upload-destination preference + routing rules (pure,
// unit-tested). Supabase here means STORAGE AS AN UPLOAD DESTINATION only —
// auth, database, tags, and audit always use Supabase regardless.

export const SUPA_PREF_KEY = "eiden-supabase";

/**
 * Disabled unless the user explicitly opted in ("1"). Fresh installs,
 * missing keys, "0", and any other value all mean OFF. Never throws.
 */
export function readSupaOff(store: Pick<Storage, "getItem">): boolean {
  try {
    return store.getItem(SUPA_PREF_KEY) !== "1";
  } catch {
    return true;
  }
}

/** Persist the toggle ("1" = on, "0" = off). Never throws. */
export function writeSupaOff(store: Pick<Storage, "setItem">, off: boolean): void {
  try {
    store.setItem(SUPA_PREF_KEY, off ? "0" : "1");
  } catch { /* private-mode storage — preference simply doesn't persist */ }
}

/**
 * Upload routing: Supabase off → Google for EVERY size (no Storage bytes at
 * any stage). Supabase on → Storage intake, except files over the Storage
 * object cap, which take the same direct-to-Google resumable path.
 */
export function shouldUploadViaGoogle(supaOff: boolean, sizeBytes: number, storageMaxBytes: number): boolean {
  return supaOff || sizeBytes > storageMaxBytes;
}

/** USB-copy mode pulls its bytes from Supabase Storage — unavailable while off. */
export function usbAllowed(supaOff: boolean): boolean {
  return !supaOff;
}
