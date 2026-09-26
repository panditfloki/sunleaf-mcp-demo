import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// In a stdio server, stdout carries the MCP protocol. A single stray console.log corrupts
// the stream, so source files may only log to stderr.
const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("stdio safety", () => {
  it("never writes to stdout from src/", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => /console\.log|process\.stdout\.write/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
