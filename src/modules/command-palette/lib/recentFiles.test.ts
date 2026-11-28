import { describe, expect, it, vi } from "vitest";
import {
  MAX_RECENT_FILES,
  recentFiles,
  recordInStore,
  recordRecentFile,
  touchRecent,
} from "./recentFiles";

const platform = vi.hoisted(() => ({ isWindows: false }));
vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() {
    return platform.isWindows;
  },
}));

describe("touchRecent", () => {
  it("moves an existing path to the front without duplicating it", () => {
    expect(touchRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("caps the list, dropping the oldest", () => {
    const many = Array.from({ length: MAX_RECENT_FILES }, (_, i) => `f${i}`);
    const out = touchRecent(many, "new");
    expect(out).toHaveLength(MAX_RECENT_FILES);
    expect(out[0]).toBe("new");
    expect(out).not.toContain(`f${MAX_RECENT_FILES - 1}`);
  });
});

describe("recordInStore", () => {
  it("keeps projects apart", () => {
    let store = recordInStore({}, "/a", "/a/x.ts");
    store = recordInStore(store, "/b", "/b/y.ts");
    expect(store).toEqual({ "/a": ["/a/x.ts"], "/b": ["/b/y.ts"] });
  });

  it("drops the least recently used roots beyond the cap", () => {
    let store = recordInStore({}, "/a", "/a/1");
    store = recordInStore(store, "/b", "/b/1", 2);
    store = recordInStore(store, "/a", "/a/2", 2);
    store = recordInStore(store, "/c", "/c/1", 2);
    expect(Object.keys(store).sort()).toEqual(["/a", "/c"]);
  });

  it("does not mutate the previous store", () => {
    const before = { "/a": ["/a/1"] };
    recordInStore(before, "/a", "/a/2");
    expect(before).toEqual({ "/a": ["/a/1"] });
  });
});

describe("persistence without localStorage", () => {
  // The vitest node environment has no localStorage; the store must degrade
  // gracefully rather than throw.
  it("reads empty and ignores writes", () => {
    expect(recentFiles("/a")).toEqual([]);
    expect(() => recordRecentFile("/a", "/a/x.ts")).not.toThrow();
  });
});

it("keeps separate histories for identical roots in local and WSL workspaces", () => {
  const root = "/repo";
  const entries = new Map([
    [
      "terax-palette-recent-files",
      JSON.stringify({ [root]: ["/repo/local.ts"] }),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  try {
    expect(recentFiles(root, "wsl:Ubuntu")).toEqual([]);
    recordRecentFile(root, "/repo/ubuntu.ts", "wsl:Ubuntu");
    recordRecentFile(root, "/repo/debian.ts", "wsl:Debian");
    expect(recentFiles(root, "local")).toEqual(["/repo/local.ts"]);
    expect(recentFiles(root, "wsl:Ubuntu")).toEqual(["/repo/ubuntu.ts"]);
    expect(recentFiles(root, "wsl:Debian")).toEqual(["/repo/debian.ts"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("upgrades only unambiguously local history from mixed legacy buckets", () => {
  const unixRoot = "/home/me/repo";
  const driveRoot = "C:/repo";
  const shareRoot = "//server/share";
  const wslRoot = "//WSL.LOCALHOST/Ubuntu/repo";
  const wslUncRoot = "\\\\?\\UNC\\wsl$\\Debian\\repo";
  const legacy = {
    [unixRoot]: [`${unixRoot}/old.ts`],
    [driveRoot]: [`${wslRoot}/old.ts`, `${driveRoot}/old.ts`],
    [shareRoot]: [`${shareRoot}/old.ts`],
    [wslRoot]: [`${wslRoot}/old.ts`],
    [wslUncRoot]: [`${wslUncRoot}\\old.ts`],
  };
  const entries = new Map([
    ["terax-palette-recent-files", JSON.stringify(legacy)],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  try {
    expect(recentFiles(unixRoot)).toEqual(legacy[unixRoot]);

    platform.isWindows = true;
    expect(recentFiles(driveRoot)).toEqual([`${driveRoot}/old.ts`]);
    expect(recentFiles(shareRoot)).toEqual(legacy[shareRoot]);
    expect(recentFiles(unixRoot)).toEqual([]);
    expect(recentFiles(unixRoot, "wsl:Ubuntu")).toEqual([]);
    expect(recentFiles(wslRoot)).toEqual([]);
    expect(recentFiles(wslUncRoot)).toEqual([]);

    recordRecentFile(unixRoot, `${unixRoot}/new-local.ts`);
    recordRecentFile(unixRoot, `${unixRoot}/new-wsl.ts`, "wsl:Ubuntu");
    expect(recentFiles(unixRoot)).toEqual([`${unixRoot}/new-local.ts`]);
    expect(recentFiles(unixRoot, "wsl:Ubuntu")).toEqual([
      `${unixRoot}/new-wsl.ts`,
    ]);
    expect(recentFiles(driveRoot)).toEqual([`${driveRoot}/old.ts`]);
  } finally {
    platform.isWindows = false;
    vi.unstubAllGlobals();
  }
});
