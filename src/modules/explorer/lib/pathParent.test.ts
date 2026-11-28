import { expect, it } from "vitest";
import { parentDir, pathBasename } from "./pathParent";

it.each([
  ["C:/README.md", "C:/", true],
  ["D:\\README.md", "D:\\", true],
  ["\\\\?\\D:\\README.md", "\\\\?\\D:\\", true],
  ["C:/repo/README.md", "C:/repo", true],
  ["\\\\server\\share\\README.md", "\\\\server\\share", true],
  ["//server/share\\README.md", "//server/share", true],
  ["/README.md", "/", false],
  ["/repo/file\\name.md", "/repo", false],
])("finds the parent directory of %s", (path, parent, windowsPaths) => {
  expect(parentDir(path, windowsPaths)).toBe(parent);
});

it("uses the supplied fallback for a path with no directory", () => {
  expect(parentDir("README.md", true, "C:/")).toBe("C:/");
});

it("uses POSIX separators for a path starting with a double slash", () => {
  const path = "//repo/notes\\draft.md";
  expect(parentDir(path, false)).toBe("//repo");
  expect(pathBasename(path, false)).toBe("notes\\draft.md");
});
