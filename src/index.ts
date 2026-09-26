#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { resolveDataDir } from "./data.js";
import { createServer } from "./server.js";

// In a stdio server, stdout carries the MCP protocol itself. Every log line goes to stderr.
async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  const server = createServer({ dataDir });
  await server.connect(new StdioServerTransport());
  console.error(`sunleaf-mcp is running (data: ${dataDir})`);
}

main().catch((error: unknown) => {
  console.error("sunleaf-mcp could not start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
