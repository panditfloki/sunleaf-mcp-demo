// Make the compiled entry point executable so it can run as the `sunleaf-mcp` bin.
// Windows has no execute bit, so skip it there.
import { chmodSync } from "node:fs";

if (process.platform !== "win32") {
  chmodSync(new URL("../build/index.js", import.meta.url), 0o755);
}
