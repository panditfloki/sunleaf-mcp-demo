import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  loadData,
  normalizeId,
  POLICY_LABELS,
  POLICY_NAMES,
  ProductSchema,
  resolveDataDir,
  type PolicyName,
  type Product,
  type SunleafData,
} from "./data.js";
import { faqIndex, passageIndex, policyPassages, productIndex, type Passage } from "./indexes.js";

export const SERVER_NAME = "sunleaf-mcp";
export const SERVER_VERSION = "0.1.0";

/** What answer_sources says when nothing in the data matches the question at all. */
export const NOT_COVERED = "No matching information in the Sunleaf data.";

/**
 * answer_sources grades each passage by the share of the question's words it contains,
 * weighted by rarity. At or above this share a passage is returned as an answer. Below it, the
 * closest passages still come back, marked as partial, because some questions are answered by
 * exclusion: "Do you ship to Canada?" is answered by the list of countries the shop ships to,
 * and word overlap cannot tell that apart from an unrelated passage. The label keeps the model
 * honest. A threshold on its own is no guarantee against guessing.
 */
export const MIN_ANSWER_COVERAGE = 0.5;

/** Every tool only reads local files. Clients can use these hints to skip confirmation prompts. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const INSTRUCTIONS = [
  "Sunleaf Tea Co. is a fictional demo shop. Answer customer questions only from these tools and resources.",
  "Use search_products and get_product for the catalog, and answer_sources, search_faqs or get_policy for FAQs and policies.",
  "Cite the ids you used, for example [SL-HRB-001], [faq-006] or [policy:returns#opened-tins].",
  "A policy that lists what the shop does, such as where it ships, also answers what it does not do.",
  "If nothing returned answers the question, tell the customer the data does not cover it instead of guessing.",
].join(" ");

const ProductSummarySchema = ProductSchema.pick({
  id: true,
  name: true,
  category: true,
  price_inr: true,
  price_usd: true,
  sizes: true,
  in_stock: true,
});

const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  /** answer: covers the question. partial: the closest match, may not answer it. scope: the rules of a policy returned above. */
  role: z.enum(["answer", "partial", "scope"]),
});
type Source = z.infer<typeof SourceSchema>;

function text(value: string) {
  return { type: "text" as const, text: value };
}

function toolError(message: string) {
  return { content: [text(message)], isError: true };
}

function formatPrice(product: Product): string {
  return `₹${product.price_inr.toLocaleString("en-IN")} / $${product.price_usd.toFixed(2)}`;
}

function productLine(product: Product): string {
  const stock = product.in_stock ? "in stock" : "out of stock";
  return `${product.id} | ${product.name} (${product.category}) | ${formatPrice(product)} | ${product.sizes.join(", ")} | ${stock}`;
}

function toSource(passage: Passage, role: Source["role"]): Source {
  return { id: passage.id, title: passage.title, text: passage.text, role };
}

function sourceBlock(source: Source): string {
  return `[${source.id}] ${source.title}\n${source.text}`;
}

export interface CreateServerOptions {
  /** Data that is already loaded. Wins over dataDir. */
  data?: SunleafData;
  /** Folder to load. Defaults to SUNLEAF_DATA_DIR, then the bundled ./data. */
  dataDir?: string;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const data = options.data ?? loadData(options.dataDir ?? resolveDataDir());
  const products = productIndex(data.products);
  const faqs = faqIndex(data.faqs);
  const passages = passageIndex(data);
  const categories = [...new Set(data.products.map((product) => product.category))].sort();
  const policies: PolicyName[] = POLICY_NAMES.filter((name) => data.policies[name] !== undefined);

  const scopes = new Map<PolicyName, Passage>();
  for (const name of policies) {
    const scope = policyPassages(name, data.policies[name] ?? "").find((passage) => passage.scope);
    if (scope) scopes.set(name, scope);
  }

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: "Sunleaf Tea Co. (demo)" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description:
        "Search the Sunleaf Tea Co. catalog by keywords such as a tea type, flavour, occasion or teaware item. " +
        "Returns matching products with id, category, price in INR and USD, sizes and stock status. Use get_product for full details.",
      inputSchema: z.object({
        query: z.string().min(1).describe('Keywords, for example "caffeine-free" or "green tea"'),
        category: z.string().optional().describe(`Optional category filter: ${categories.join(", ")}`),
        in_stock_only: z.boolean().optional().describe("Return only products that are in stock"),
        max_results: z.number().int().min(1).max(10).optional().describe("How many results to return, 1 to 10 (default 8)"),
      }),
      outputSchema: z.object({ results: z.array(ProductSummarySchema) }),
      annotations: READ_ONLY,
    },
    async ({ query, category, in_stock_only, max_results }) => {
      const wanted = category === undefined ? undefined : categories.find((c) => c.toLowerCase() === category.trim().toLowerCase());
      if (category !== undefined && wanted === undefined) {
        return toolError(`Unknown category "${category}". Valid categories: ${categories.join(", ")}.`);
      }
      const hits = products.search(query, {
        limit: max_results ?? 8,
        filter: (product) => (wanted === undefined || product.category === wanted) && (!in_stock_only || product.in_stock),
      });
      const results = hits.map((hit) => ProductSummarySchema.parse(hit.item));
      const body =
        hits.length === 0
          ? `No products matched "${query}".`
          : [`Products matching "${query}":`, ...hits.map((hit) => productLine(hit.item))].join("\n");
      return { content: [text(body)], structuredContent: { results } };
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description: "Full details for one Sunleaf product by its id (from search_products): description, sizes, tags, price and stock.",
      inputSchema: z.object({ id: z.string().min(1).describe("Product id, for example SL-HRB-001") }),
      outputSchema: z.object({ product: ProductSchema }),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const wanted = normalizeId(id);
      const product = data.products.find((p) => normalizeId(p.id) === wanted);
      if (!product) return toolError(`No product with id "${id}". Use search_products to find valid ids.`);
      const details = [
        `${product.name} [${product.id}]`,
        `Category: ${product.category}`,
        `Price: ${formatPrice(product)}`,
        `Sizes: ${product.sizes.join(", ")}`,
        `Stock: ${product.in_stock ? "in stock" : "out of stock"}`,
        `Tags: ${product.tags.join(", ")}`,
        `Description: ${product.short_description}`,
      ].join("\n");
      return { content: [text(details)], structuredContent: { product } };
    },
  );

  server.registerTool(
    "search_faqs",
    {
      title: "Search FAQs",
      description: "Find the Sunleaf FAQ entries that best match a question. Returns each question and answer with its FAQ id for citation.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The customer's question or keywords"),
        max_results: z.number().int().min(1).max(5).optional().describe("How many FAQs to return, 1 to 5 (default 3)"),
      }),
      annotations: READ_ONLY,
    },
    async ({ query, max_results }) => {
      const hits = faqs.search(query, { limit: max_results ?? 3 });
      if (hits.length === 0) return { content: [text(`No FAQ matched "${query}".`)] };
      const body = hits.map((hit) => `[${hit.item.id}] Q: ${hit.item.question}\nA: ${hit.item.answer}`).join("\n\n");
      return { content: [text(body)] };
    },
  );

  server.registerTool(
    "get_policy",
    {
      title: "Get policy",
      description: "The full text of one Sunleaf store policy as Markdown: shipping, returns, privacy or wholesale.",
      inputSchema: z.object({ name: z.enum(POLICY_NAMES).describe("Which policy to read") }),
      annotations: READ_ONLY,
    },
    async ({ name }) => {
      const markdown = data.policies[name];
      if (markdown === undefined) return toolError(`The ${name} policy is not in this data folder.`);
      return { content: [text(`Source: [policy:${name}]\n\n${markdown.trim()}`)] };
    },
  );

  server.registerTool(
    "answer_sources",
    {
      title: "Find answer sources",
      description:
        "Search the FAQs and policies together for a customer question. Returns passages with ids to cite, marked as answers " +
        "or as partial matches, plus the scope rules of any policy they come from or are governed by. A partial match can still answer by " +
        "exclusion: a list of the countries the shop ships to answers whether it ships somewhere else. If nothing matches, " +
        "it says so: tell the customer instead of guessing.",
      inputSchema: z.object({ question: z.string().min(1).describe("The customer's question, in their own words") }),
      outputSchema: z.object({ match: z.enum(["full", "partial", "none"]), sources: z.array(SourceSchema) }),
      annotations: READ_ONLY,
    },
    async ({ question }) => {
      const hits = passages.search(question, { limit: 5 });
      if (hits.length === 0) {
        return {
          content: [text(`${NOT_COVERED} Tell the customer this is not covered instead of guessing.`)],
          structuredContent: { match: "none" as const, sources: [] },
        };
      }

      const answers = hits.filter((hit) => hit.coverage >= MIN_ANSWER_COVERAGE).slice(0, 3);
      const match = answers.length > 0 ? ("full" as const) : ("partial" as const);
      const chosen = answers.length > 0 ? answers : hits;
      const sources = chosen.map((hit) => toSource(hit.item, match === "full" ? "answer" : "partial"));

      // A policy's first section states its scope, such as where the shop ships. Keep it beside any
      // other section of that policy, and beside any FAQ the policy governs, so an answer about shipping
      // costs or wholesale accounts cannot lose the rule about where the shop ships.
      for (const hit of chosen) {
        const scope = hit.item.policy === undefined ? undefined : scopes.get(hit.item.policy);
        if (scope && !sources.some((source) => source.id === scope.id)) sources.push(toSource(scope, "scope"));
      }

      const found = sources.filter((source) => source.role !== "scope");
      const rules = sources.filter((source) => source.role === "scope");
      const body = [
        match === "full"
          ? `Sources for: "${question}"`
          : `No passage matches the whole question: "${question}". Closest partial matches:`,
        ...found.map(sourceBlock),
        ...(rules.length > 0 ? ["Policy scope, to read together with the passages above:", ...rules.map(sourceBlock)] : []),
        match === "full"
          ? "Answer only from these passages and cite their ids. If they do not answer the question, say the Sunleaf data does not cover it."
          : "Use a passage only if it actually answers the question. A list of what the shop does, such as the countries it ships to, also answers whether it does something else. If nothing here answers the question, tell the customer the Sunleaf data does not cover it. Cite the ids you use.",
      ].join("\n\n");
      return { content: [text(body)], structuredContent: { match, sources } };
    },
  );

  server.registerResource(
    "catalog",
    "sunleaf://catalog",
    { title: "Product catalog", description: "Every Sunleaf Tea Co. product (fictional demo data).", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data.products, null, 2) }],
    }),
  );

  server.registerResource(
    "faqs",
    "sunleaf://faqs",
    { title: "FAQs", description: "Every Sunleaf Tea Co. FAQ (fictional demo data).", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data.faqs, null, 2) }],
    }),
  );

  server.registerResource(
    "policies",
    new ResourceTemplate("sunleaf://policies/{name}", {
      list: async () => ({
        resources: policies.map((name) => ({
          uri: `sunleaf://policies/${name}`,
          name: `policy-${name}`,
          title: POLICY_LABELS[name],
          mimeType: "text/markdown",
        })),
      }),
      complete: { name: (value) => policies.filter((name) => name.startsWith(value)) },
    }),
    { title: "Store policies", description: "Shipping, returns, privacy and wholesale policies (sample text).", mimeType: "text/markdown" },
    async (uri, variables) => {
      const raw = variables.name;
      const name = (Array.isArray(raw) ? raw[0] : raw) ?? "";
      const policy = policies.find((candidate) => candidate === name);
      if (policy === undefined) throw new Error(`Unknown policy "${name}". Available: ${policies.join(", ")}.`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: data.policies[policy] ?? "" }] };
    },
  );

  server.registerPrompt(
    "customer_reply",
    {
      title: "Reply to a customer",
      description: "Draft a reply to a customer message using only the Sunleaf tools and sources, with citations.",
      argsSchema: z.object({ customer_message: z.string().min(1).describe("The message from the customer") }),
    },
    ({ customer_message }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "You are the customer assistant for Sunleaf Tea Co., a fictional demo tea shop.",
              "Answer the customer message below using only the Sunleaf tools and resources: search_products, get_product, search_faqs, get_policy and answer_sources.",
              "Cite the ids of the sources you used in square brackets, for example [faq-006].",
              "A policy that lists what the shop does, such as where it ships, also answers what it does not do.",
              "If the data does not cover something, say so plainly instead of guessing.",
              "",
              `Customer message: ${customer_message}`,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
