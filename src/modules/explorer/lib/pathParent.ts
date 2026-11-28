const DRIVE_ROOT = /^(?:[/\\]{2}\?[/\\])?[a-z]:[/\\]/i;

function lastSeparator(path: string, windowsPaths: boolean): number {
  const slash = path.lastIndexOf("/");
  return windowsPaths ? Math.max(slash, path.lastIndexOf("\\")) : slash;
}

export function pathBasename(path: string, windowsPaths: boolean): string {
  return path.slice(lastSeparator(path, windowsPaths) + 1);
}

export function parentDir(
  path: string,
  windowsPaths: boolean,
  fallback = path,
): string {
  const i = lastSeparator(path, windowsPaths);
  if (i < 0) return fallback;
  const driveRoot = windowsPaths ? DRIVE_ROOT.exec(path)?.[0] : undefined;
  // A drive letter without its separator is relative to that drive's cwd.
  if (i === 0 || i + 1 === driveRoot?.length) return path.slice(0, i + 1);
  return path.slice(0, i);
}
