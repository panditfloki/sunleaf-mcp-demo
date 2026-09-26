import { readFileSync } from "node:fs";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadData } from "../src/data.js";
import { policyPassages } from "../src/indexes.js";
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

  it("finds a product by id regardless of case or surrounding spaces", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_product", arguments: { id: "  sl-hrb-003 " } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Peppermint Leaf [SL-HRB-003]");
  });

  it("returns every caffeine-free tea under $15 when given the whole question", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "search_products",
      arguments: { query: "Do you have a caffeine-free tea under $15?" },
    });
    const { results } = result.structuredContent as { results: { id: string }[] };
    expect(results.map((product) => product.id)).toEqual(
      expect.arrayContaining(["SL-HRB-001", "SL-HRB-002", "SL-HRB-003", "SL-HRB-004"]),
    );
  });

  describe("answer_sources", () => {
    async function askWith(client: Client, question: string) {
      const result = await client.callTool({ name: "answer_sources", arguments: { question } });
      const structured = result.structuredContent as { match: string; sources: { id: string; role: string }[] };
      return {
        text: textOf(result),
        match: structured.match,
        sources: structured.sources,
        ids: structured.sources.map((source) => source.id),
      };
    }

    async function ask(question: string) {
      return askWith(await connect(), question);
    }

    /** The passages returned as the answer itself, leaving out the policy scope rules added beside them. */
    function found(sources: { id: string; role: string }[]): string[] {
      return sources.filter((source) => source.role !== "scope").map((source) => source.id);
    }

    it("returns cited answers when the data covers the question", async () => {
      const { match, ids } = await ask("What is your return policy for opened tins?");
      expect(match).toBe("full");
      expect(ids).toContain("policy:returns#opened-tins");
    });

    it("answers Canada from the shipping list instead of calling it not covered", async () => {
      const { match, ids, text } = await ask("Do you ship to Canada?");
      expect(match).toBe("partial");
      expect(ids).toContain("policy:shipping#where-we-ship");
      expect(text).not.toContain(NOT_COVERED);
    });

    it("still finds the shipping list when the question is paraphrased", async () => {
      const { ids } = await ask("Do you deliver to Canada?");
      expect(ids).toContain("policy:shipping#where-we-ship");
    });

    it("keeps the destination rule beside shipping costs", async () => {
      const { ids } = await ask("What are the shipping costs for international orders to Canada?");
      expect(ids).toContain("policy:shipping#shipping-costs");
      expect(ids).toContain("policy:shipping#where-we-ship");
    });

    it("keeps the India-only wholesale rule beside a wholesale FAQ that wins on its own", async () => {
      const { match, sources, text } = await ask("Do you sell wholesale to cafes in Canada?");
      expect(match).toBe("full");
      // The case under test: an FAQ is the only answer and no wholesale policy section is.
      expect(found(sources)).toContain("faq-019");
      expect(found(sources).every((id) => id.startsWith("faq-"))).toBe(true);
      expect(sources).toContainEqual(expect.objectContaining({ id: "policy:wholesale#who-can-apply", role: "scope" }));
      expect(text).toContain("Wholesale orders ship inside India only.");
    });

    it("keeps the destination list beside a shipping FAQ that wins on its own", async () => {
      const { sources, text } = await ask("How long does delivery take to Canada?");
      // faq-002 gives international delivery times. Without the destination list, it reads as a yes.
      expect(found(sources)).toContain("faq-002");
      expect(found(sources).every((id) => id.startsWith("faq-"))).toBe(true);
      expect(sources).toContainEqual(expect.objectContaining({ id: "policy:shipping#where-we-ship", role: "scope" }));
      expect(text).toContain("We do not ship to other countries");
    });

    it("returns the governing policy's scope with every FAQ linked to a policy", async () => {
      const data = loadData();
      const client = await connect();
      let checked = 0;
      for (const faq of data.faqs) {
        const policy = faq.policy;
        if (policy === undefined) continue;
        const scope = policyPassages(policy, data.policies[policy] ?? "").find((passage) => passage.scope);
        const { ids } = await askWith(client, faq.question);
        expect(ids, faq.id).toContain(faq.id);
        expect(ids, `${faq.id} without its ${policy} scope`).toContain(scope?.id);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0);
    });

    it("never presents a fact the data does not hold as a full answer", async () => {
      const { match } = await ask("What is your FSSAI licence number?");
      expect(match).not.toBe("full");
    });

    it("says not covered when nothing in the data matches", async () => {
      const { match, ids, text } = await ask("Can I pay with Bitcoin?");
      expect(match).toBe("none");
      expect(ids).toEqual([]);
      expect(text).toContain(NOT_COVERED);
    });
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
