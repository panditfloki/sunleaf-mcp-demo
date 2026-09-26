import { readFileSync } from "node:fs";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, NOT_COVERED, SERVER_VERSION } from "../src/server.js";

let disconnect: (() => Promise<void>) | undefined;

afterEach(async () => {
  await disconnect?.();
  disconnect = undefined;
});

/** A real MCP client talking to the real server, linked in memory instead of over stdio. */
async function connect(): Promise<Client> {
  const server = createServer();
  const client = new Client({ name: "sunleaf-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  disconnect = async () => {
    await client.close();
    await server.close();
  };
  return client;
}

function textOf(result: { content?: unknown }): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

describe("sunleaf MCP server", () => {
  it("lists exactly the five tools, all read-only", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "answer_sources",
      "get_policy",
      "get_product",
      "search_faqs",
      "search_products",
    ]);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("answers an FAQ search with FAQ ids", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "search_faqs", arguments: { query: "how do I store tea" } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("[faq-016]");
  });

  it("returns a policy as Markdown", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_policy", arguments: { name: "returns" } });
    expect(textOf(result)).toContain("[policy:returns]");
    expect(textOf(result)).toContain("Sample policy for demo purposes only");
  });

  it("rejects a policy name that does not exist", async () => {
    const client = await connect();
    const rejected = await client
      .callTool({ name: "get_policy", arguments: { name: "refunds" } })
      .then((result) => result.isError === true, () => true);
    expect(rejected).toBe(true);
  });

  it("reports an unknown product id as an error", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_product", arguments: { id: "SL-NOPE-999" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No product with id");
  });

  it("returns full product details with structured content", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_product", arguments: { id: "sl-hrb-001" } });
    expect(textOf(result)).toContain("Chamomile Calm [SL-HRB-001]");
    expect(result.structuredContent).toMatchObject({ product: { id: "SL-HRB-001", in_stock: true } });
  });

  it("returns structured product results and respects in_stock_only", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "search_products",
      arguments: { query: "green", in_stock_only: true, max_results: 10 },
    });
    const { results } = result.structuredContent as { results: { id: string; in_stock: boolean }[] };
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((product) => product.in_stock)).toBe(true);
    expect(results.map((product) => product.id)).not.toContain("SL-GRN-003");
  });

  it("rejects an unknown category with the valid list", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "search_products", arguments: { query: "tea", category: "coffee" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Valid categories");
  });

  it("cites sources for a covered question and does not guess otherwise", async () => {
    const client = await connect();
    const covered = await client.callTool({
      name: "answer_sources",
      arguments: { question: "What is your return policy for opened tins?" },
    });
    expect(textOf(covered)).toContain("[policy:returns#opened-tins]");

    const notCovered = await client.callTool({ name: "answer_sources", arguments: { question: "Do you ship to Canada?" } });
    expect(textOf(notCovered)).toContain(NOT_COVERED);
    expect(notCovered.structuredContent).toEqual({ sources: [] });
  });

  it("serves the catalog, FAQs and policies as resources", async () => {
    const client = await connect();
    const catalog = await client.readResource({ uri: "sunleaf://catalog" });
    const first = catalog.contents[0] as { text?: string; mimeType?: string };
    expect(first.mimeType).toBe("application/json");
    expect(JSON.parse(first.text ?? "[]")).toHaveLength(20);

    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(["sunleaf://catalog", "sunleaf://faqs", "sunleaf://policies/returns"]),
    );

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toContain("sunleaf://policies/{name}");

    const policy = await client.readResource({ uri: "sunleaf://policies/shipping" });
    expect((policy.contents[0] as { text?: string }).text).toContain("# Shipping Policy");
  });

  it("offers the customer_reply prompt", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toContain("customer_reply");
    const prompt = await client.getPrompt({
      name: "customer_reply",
      arguments: { customer_message: "Is chamomile caffeine-free?" },
    });
    const content = prompt.messages[0]?.content as { text?: string };
    expect(content.text).toContain("Is chamomile caffeine-free?");
  });

  it("keeps the server version in step with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
