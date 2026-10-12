import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verification items covered here (server-side, no prod data, no network):
//   missing_primary_fixture      getAccounts never auto-inserts with the check on
//   unknown_account_rejection    requireActiveAccount/driveGoneReason → 404 drive_deleted
//   disabled_account_rejection   requireActiveAccount/driveGoneReason → 410 drive_disabled
//   pending_relink               null-pin google rows → 409 pending_relink (fail-closed)
//   no_env_leak                  driveCtxFor(null)/refreshTokenFor(null) ignore GOOGLE_REFRESH_TOKEN with check on
//   check_off_restores_legacy    ACTIVE_DRIVE_CHECK=0 (or stored off) re-enables every legacy path
// Live-only items (300MB+ resumable control, CORS probe, reconcile true/false
// against real Drive, second-drive scope, full-text hidden refs, delete-upload
// cleanup) stay manual — see the drive-hardening checklist in the release notes.

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const DISABLED = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";

const row = (id: string, status: string) => ({
  id, label: `D-${id.slice(0, 4)}`, email: null, refresh_token: "rt", root_id: "scope-root", status, priority: 0,
});

const state = {
  accounts: {} as Record<string, ReturnType<typeof row>>,
  settingRow: null as null | { value: unknown },
};

const ops: string[] = [];

function table(name: string): any {
  const q: any = {
    select: () => q,
    order: () => q,
    limit: () => q,
    single: async () => ({ data: null }),
    insert: (r: unknown) => {
      ops.push(`insert:${name}:${JSON.stringify(r).slice(0, 80)}`);
      return { select: () => ({ single: async () => ({ data: { id: "auto-primary" }, error: null }) }) };
    },
    upsert: (r: unknown) => {
      ops.push(`upsert:${name}`);
      return { error: null };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
    eq: (col: string, val: unknown) => { q._eq = val; return q; },
    maybeSingle: async () => {
      if (name === "drive_accounts") return { data: state.accounts[q._eq] ?? null };
      if (name === "app_settings") return { data: state.settingRow, error: null };
      return { data: null };
    },
    // list queries (getAccounts order, hasAnyAccountRows limit) are awaited directly
    then: (resolve: (v: unknown) => unknown) => {
      if (name === "drive_accounts") return Promise.resolve({ data: Object.values(state.accounts) }).then(resolve);
      return Promise.resolve({ data: null }).then(resolve);
    },
  };
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));

import {
  activeDriveCheckEnabled,
  bustAccountCache,
  bustSettingsCache,
  driveBlockedResponse,
  driveCtxFor,
  driveGoneReason,
  getAccounts,
  hasAnyAccountRows,
  refreshTokenFor,
  requireActiveAccount,
  setActiveDriveCheck,
} from "@/lib/drive-accounts";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  ops.length = 0;
  state.accounts = { [ACTIVE]: row(ACTIVE, "active"), [DISABLED]: row(DISABLED, "disabled") };
  state.settingRow = null;
  bustAccountCache();
  bustSettingsCache();
  for (const k of ["ACTIVE_DRIVE_CHECK", "GOOGLE_REFRESH_TOKEN"]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ["ACTIVE_DRIVE_CHECK", "GOOGLE_REFRESH_TOKEN"]) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("active_drive_check flag", () => {
  it("defaults ON (missing_primary_fixture: no table row, no env)", async () => {
    expect(await activeDriveCheckEnabled()).toBe(true);
  });
  it("env ACTIVE_DRIVE_CHECK=0 restores legacy (check_off_restores_legacy)", async () => {
    process.env.ACTIVE_DRIVE_CHECK = "0";
    expect(await activeDriveCheckEnabled()).toBe(false);
  });
  it("stored setting beats env", async () => {
    process.env.ACTIVE_DRIVE_CHECK = "0";
    state.settingRow = { value: "1" };
    expect(await activeDriveCheckEnabled()).toBe(true);
  });
  it("setActiveDriveCheck persists + busts cache", async () => {
    await setActiveDriveCheck(false);
    expect(ops.some((o) => o.startsWith("upsert:app_settings"))).toBe(true);
    state.settingRow = { value: "0" };
    expect(await activeDriveCheckEnabled()).toBe(false);
  });
});

describe("getAccounts auto-import gate", () => {
  it("never auto-inserts Primary with the check on, even with env token set", async () => {
    process.env.GOOGLE_REFRESH_TOKEN = "env-token";
    state.accounts = {};
    const accs = await getAccounts();
    expect(accs).toEqual([]);
    expect(ops.some((o) => o.startsWith("insert:drive_accounts"))).toBe(false);
  });
  it("auto-inserts Primary only with the check off", async () => {
    process.env.ACTIVE_DRIVE_CHECK = "0";
    process.env.GOOGLE_REFRESH_TOKEN = "env-token";
    state.accounts = {};
    await getAccounts();
    expect(ops.some((o) => o.startsWith("insert:drive_accounts"))).toBe(true);
  });
});

describe("fail-closed gates", () => {
  it("unknown_account_rejection: 404 drive_deleted", async () => {
    const g = await requireActiveAccount(MISSING);
    expect(g).toMatchObject({ code: "drive_deleted", status: 404 });
    const b = await driveGoneReason(MISSING);
    expect(b).toMatchObject({ code: "drive_deleted", status: 404 });
  });
  it("disabled_account_rejection: 410 drive_disabled", async () => {
    const g = await requireActiveAccount(DISABLED);
    expect(g).toMatchObject({ code: "drive_disabled", status: 410 });
    const b = await driveGoneReason(DISABLED);
    expect(b).toMatchObject({ code: "drive_disabled", status: 410 });
  });
  it("active account passes both gates", async () => {
    const g = await requireActiveAccount(ACTIVE);
    expect("account" in g && (g as { account: { id: string } }).account.id).toBe(ACTIVE);
    expect(await driveGoneReason(ACTIVE)).toBeNull();
  });
  it("pending_relink: null pin fails closed with 409", async () => {
    expect(await driveGoneReason(null)).toMatchObject({ code: "pending_relink", status: 409 });
    expect(await driveGoneReason(undefined)).toMatchObject({ code: "pending_relink", status: 409 });
  });
  it("driveBlockedResponse carries code + status", async () => {
    const r = driveBlockedResponse({ error: "x", code: "drive_disabled", status: 410 });
    expect(r.status).toBe(410);
    expect(await r.json()).toMatchObject({ error: "x", code: "drive_disabled" });
  });
});

describe("no_env_leak", () => {
  it("driveCtxFor(null) ignores the env token with the check on", async () => {
    process.env.GOOGLE_REFRESH_TOKEN = "env-token";
    expect(await driveCtxFor(null)).toBeNull();
    expect(await driveCtxFor(undefined)).toBeNull();
  });
  it("refreshTokenFor(null) ignores the env token with the check on", async () => {
    process.env.GOOGLE_REFRESH_TOKEN = "env-token";
    expect(await refreshTokenFor(null)).toBeNull();
  });
  it("legacy env paths work again with the check off", async () => {
    process.env.ACTIVE_DRIVE_CHECK = "0";
    process.env.GOOGLE_REFRESH_TOKEN = "env-token";
    expect(await refreshTokenFor(null)).toBe("env-token");
  });
});

describe("hasAnyAccountRows", () => {
  it("distinguishes empty table (deleted → 404) from all-disabled (→ 410)", async () => {
    state.accounts = {};
    bustAccountCache();
    expect(await hasAnyAccountRows()).toBe(false);
    state.accounts = { [DISABLED]: row(DISABLED, "disabled") };
    expect(await hasAnyAccountRows()).toBe(true);
  });
});
