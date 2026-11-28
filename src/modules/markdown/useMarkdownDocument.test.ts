import type { WorkspaceEnv } from "@/modules/workspace";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type MarkdownStatus,
  useMarkdownDocument,
} from "./useMarkdownDocument";

const harness = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | undefined)[],
  refs: [] as { current: unknown }[],
  refIndex: 0,
  invoke: vi.fn(),
  listenFsChanged: vi.fn(),
  listenWritten: vi.fn(),
  watchAdd: vi.fn<() => Promise<void>>(),
  currentWorkspaceEnv: vi.fn<() => WorkspaceEnv>(),
  status: { kind: "loading" } as MarkdownStatus,
}));

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: harness.currentWorkspaceEnv,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: harness.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: (event: string, handler: unknown) =>
      event === "fs:changed"
        ? harness.listenFsChanged(handler)
        : harness.listenWritten(handler),
  }),
}));
vi.mock("react", () => ({
  useEffect: (effect: () => (() => void) | undefined) => {
    harness.effects.push(effect);
  },
  useRef: <T>(current: T) => (harness.refs[harness.refIndex++] ??= { current }),
  useState: () => [
    harness.status,
    (action: MarkdownStatus | ((prev: MarkdownStatus) => MarkdownStatus)) => {
      harness.status =
        typeof action === "function" ? action(harness.status) : action;
    },
  ],
}));

const path = "/repo/README.md";
const watchArgs = {
  paths: ["/repo"],
  files: [path],
  workspace: { kind: "local" },
};

function render(visible: boolean) {
  harness.refIndex = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: effects use the explicit test scheduler above.
  useMarkdownDocument(path, visible);
  return harness.effects.splice(0);
}

function mount() {
  const cleanups = render(true).map((effect) => effect());
  return () => {
    for (const cleanup of cleanups) cleanup?.();
  };
}

function pending<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.effects = [];
  harness.refs = [];
  harness.status = { kind: "loading" };
  vi.resetAllMocks();
  harness.currentWorkspaceEnv.mockReturnValue({ kind: "local" });
  harness.listenFsChanged.mockResolvedValue(vi.fn());
  harness.listenWritten.mockResolvedValue(vi.fn());
  harness.watchAdd.mockResolvedValue(undefined);
  harness.invoke.mockImplementation((command: string) => {
    if (command === "fs_watch_add") return harness.watchAdd();
    if (command === "fs_canonicalize") return Promise.resolve(path);
    if (command === "fs_read_file") {
      return Promise.resolve({ kind: "text", content: "initial" });
    }
    return Promise.resolve();
  });
});
afterEach(() => vi.useRealTimers());

it("installs both listeners and awaits native watch registration before reading", async () => {
  const fs = pending<() => void>();
  const written = pending<() => void>();
  const add = pending<void>();
  harness.listenFsChanged.mockReturnValue(fs.promise);
  harness.listenWritten.mockReturnValue(written.promise);
  harness.watchAdd.mockReturnValueOnce(add.promise);
  const unmount = mount();
  fs.resolve(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.watchAdd).not.toHaveBeenCalled();
  expect(harness.invoke).not.toHaveBeenCalledWith(
    "fs_read_file",
    expect.anything(),
  );
  written.resolve(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.invoke).toHaveBeenCalledWith("fs_watch_add", watchArgs);
  const onFsChanged = harness.listenFsChanged.mock.calls[0][0];
  onFsChanged({ payload: { paths: [path] } });
  await vi.advanceTimersByTimeAsync(150);
  expect(harness.invoke).not.toHaveBeenCalledWith(
    "fs_read_file",
    expect.anything(),
  );
  add.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.status).toEqual({ kind: "ready", content: "initial" });

  harness.invoke.mockResolvedValueOnce({ kind: "text", content: "changed" });
  onFsChanged({ payload: { paths: [path] } });
  await vi.advanceTimersByTimeAsync(150);
  expect(harness.status).toEqual({ kind: "ready", content: "changed" });
  unmount();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.invoke).toHaveBeenCalledWith("fs_watch_remove", watchArgs);
});

it("disposes listeners that resolve after the preview closes without registering a watch", async () => {
  const written = pending<() => void>();
  const unlistenFs = vi.fn();
  const unlistenWritten = vi.fn();
  harness.listenFsChanged.mockResolvedValue(unlistenFs);
  harness.listenWritten.mockReturnValue(written.promise);
  const unmount = mount();
  await vi.advanceTimersByTimeAsync(0);
  unmount();
  written.resolve(unlistenWritten);
  await vi.advanceTimersByTimeAsync(0);
  expect(unlistenFs).toHaveBeenCalledTimes(1);
  expect(unlistenWritten).toHaveBeenCalledTimes(1);
  expect(harness.watchAdd).not.toHaveBeenCalled();
  expect(harness.invoke).not.toHaveBeenCalledWith("fs_watch_remove", watchArgs);
  expect(harness.invoke).not.toHaveBeenCalledWith(
    "fs_read_file",
    expect.anything(),
  );
});

it("still loads the document if a listener and the native watch fail to register", async () => {
  harness.listenFsChanged.mockRejectedValue(new Error("listener unavailable"));
  harness.watchAdd.mockRejectedValueOnce(new Error("watch unavailable"));
  const unmount = mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.status).toEqual({ kind: "ready", content: "initial" });
  unmount();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.invoke).not.toHaveBeenCalledWith("fs_watch_remove", watchArgs);
});

it("removes the watch after a pending native add settles on close", async () => {
  const add = pending<void>();
  harness.watchAdd.mockReturnValueOnce(add.promise);
  const unmount = mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.invoke).toHaveBeenCalledWith("fs_watch_add", watchArgs);
  unmount();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.invoke).not.toHaveBeenCalledWith("fs_watch_remove", watchArgs);
  add.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.invoke).toHaveBeenCalledWith("fs_watch_remove", watchArgs);
  expect(harness.invoke).not.toHaveBeenCalledWith(
    "fs_read_file",
    expect.anything(),
  );
});

it("reloads a WSL preview for a host watch path in its distro", async () => {
  harness.currentWorkspaceEnv.mockReturnValue({ kind: "wsl", distro: "Ubuntu" });
  const unmount = mount();
  await vi.advanceTimersByTimeAsync(0);
  harness.invoke.mockClear();
  const onFsChanged = harness.listenFsChanged.mock.calls[0][0];
  onFsChanged({ payload: { paths: [`//wsl.localhost/Ubuntu-other${path}`] } });
  await vi.advanceTimersByTimeAsync(150);
  expect(harness.invoke).not.toHaveBeenCalled();

  harness.invoke.mockResolvedValueOnce({ kind: "text", content: "changed" });
  onFsChanged({ payload: { paths: [`//wsl.localhost/ubuntu${path}`] } });
  await vi.advanceTimersByTimeAsync(150);
  expect(harness.status).toEqual({ kind: "ready", content: "changed" });
  unmount();
});

it("defers an already queued reload if the preview becomes hidden", async () => {
  const unmount = mount();
  await vi.advanceTimersByTimeAsync(0);
  harness.invoke.mockClear();
  harness.listenFsChanged.mock.calls[0][0]({ payload: { paths: [path] } });
  // Only the visibility effect changes for this rerender; path is unchanged.
  render(false)[0]();
  await vi.advanceTimersByTimeAsync(150);
  expect(harness.invoke).not.toHaveBeenCalled();
  harness.invoke.mockResolvedValueOnce({ kind: "text", content: "changed" });
  render(true)[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.invoke).toHaveBeenCalledExactlyOnceWith("fs_read_file", {
    path,
    workspace: { kind: "local" },
  });
  expect(harness.status).toEqual({ kind: "ready", content: "changed" });
  unmount();
});
