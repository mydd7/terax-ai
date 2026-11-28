import { expect, it } from "vitest";
import { planExplorerRename, removedChildDirectories } from "./useFileTree";

it.each([
  ["C:/", true],
  ["/", false],
])(
  "keeps %s watched when a cached child disappears",
  (root, windowsPaths) => {
    const removed = `${root}removed`;
    const live = `${root}live`;
    expect(
      removedChildDirectories(
        root,
        [root, removed, `${removed}/nested`, live],
        new Set([live]),
        windowsPaths,
      ),
    ).toEqual([removed]);
  },
);

it("compares the full filename when renaming at a Windows drive root", () => {
  expect(planExplorerRename("C:/README.md", "README.md", true)).toBeNull();
  expect(planExplorerRename("C:/README.md", "EADME.md", true)).toEqual({
    parent: "C:/",
    to: "C:/EADME.md",
  });
});

it.each([
  ["D:\\README.md", "README.md", "D:\\", "D:\\renamed.md", true],
  ["/repo/a\\b.md", "a\\b.md", "/repo", "/repo/renamed.md", false],
])(
  "keeps the filename and parent rules aligned for %s",
  (path, basename, parent, to, windowsPaths) => {
    expect(planExplorerRename(path, basename, windowsPaths)).toBeNull();
    expect(planExplorerRename(path, "renamed.md", windowsPaths)).toEqual({
      parent,
      to,
    });
  },
);
