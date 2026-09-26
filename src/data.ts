import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** The package root: the folder above src/ (tests, `npm run dev`) or build/ (compiled). */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const POLICY_NAMES = ["shipping", "returns", "privacy", "wholesale"] as const;
export type PolicyName = (typeof POLICY_NAMES)[number];

export const POLICY_LABELS: Record<PolicyName, string> = {
  shipping: "Shipping policy",
  returns: "Returns policy",
  privacy: "Privacy policy",
  wholesale: "Wholesale policy",
};

export const ProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  price_inr: z.number().nonnegative(),
  price_usd: z.number().nonnegative(),
  sizes: z.array(z.string()),
  in_stock: z.boolean(),
  tags: z.array(z.string()),
  short_description: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

export const FaqSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()),
});
export type Faq = z.infer<typeof FaqSchema>;

export interface SunleafData {
  dataDir: string;
  products: Product[];
  faqs: Faq[];
  /** Markdown per policy. A policy with no file in the data folder is left out. */
  policies: Partial<Record<PolicyName, string>>;
}

/**
 * The data folder. SUNLEAF_DATA_DIR wins when set. A relative value is resolved from the
 * package root, not the current directory, because AI clients start the server from a
 * working directory you do not control.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SUNLEAF_DATA_DIR?.trim();
  return fromEnv ? resolve(PACKAGE_ROOT, fromEnv) : join(PACKAGE_ROOT, "data");
}

function readRecords<T extends { id: string }>(file: string, schema: z.ZodType<T>): T[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = z.array(schema).safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${file} does not match the expected format. ${problems}`);
  }
  const seen = new Set<string>();
  for (const record of parsed.data) {
    if (seen.has(record.id)) throw new Error(`${file} has a duplicate id "${record.id}".`);
    seen.add(record.id);
  }
  return parsed.data;
}

/** Load products, FAQs and whichever of the four policies exist. Bad files fail with a readable error. */
export function loadData(dataDir: string = resolveDataDir()): SunleafData {
  const products = readRecords(join(dataDir, "products.json"), ProductSchema);
  const faqs = readRecords(join(dataDir, "faqs.json"), FaqSchema);
  const policies: Partial<Record<PolicyName, string>> = {};
  for (const name of POLICY_NAMES) {
    const file = join(dataDir, "policies", `${name}.md`);
    if (existsSync(file)) policies[name] = readFileSync(file, "utf8");
  }
  return { dataDir, products, faqs, policies };
}
