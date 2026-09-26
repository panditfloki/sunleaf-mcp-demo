import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadData, PACKAGE_ROOT, POLICY_NAMES, resolveDataDir } from "../src/data.js";

const tempDirs: string[] = [];

function makeDataDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sunleaf-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const product = {
  id: "X-1",
  name: "Test Tea",
  category: "green tea",
  price_inr: 100,
  price_usd: 2,
  sizes: ["50 g"],
  in_stock: true,
  tags: ["test"],
  short_description: "A test tea.",
};
const faq = { id: "faq-x", question: "Is this a test?", answer: "Yes.", tags: ["test"] };

describe("bundled data", () => {
  it("has 20 products, 25 FAQs and all four policies", () => {
    const data = loadData();
    expect(data.products).toHaveLength(20);
    expect(data.faqs).toHaveLength(25);
    expect(Object.keys(data.policies).sort()).toEqual([...POLICY_NAMES].sort());
  });

  it("marks every policy as sample text and uses no real email address", () => {
    const data = loadData();
    for (const markdown of Object.values(data.policies)) {
      expect(markdown).toContain("Sample policy for demo purposes only");
    }
    const emails = JSON.stringify(data).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((email) => email === "support@example.com")).toBe(true);
  });

  it("links every FAQ tagged with a policy's name to that policy, and no other FAQ", () => {
    const data = loadData();
    const policyNames: readonly string[] = POLICY_NAMES;
    for (const faq of data.faqs) {
      const tagged = faq.tags.filter((tag) => policyNames.includes(tag));
      expect(tagged.length, faq.id).toBeLessThanOrEqual(1);
      expect(faq.policy, faq.id).toBe(tagged[0]);
    }
    expect(data.faqs.some((faq) => faq.policy === "wholesale")).toBe(true);
    expect(data.faqs.some((faq) => faq.policy === "shipping")).toBe(true);
  });
});

describe("data folder", () => {
  it("defaults to the data folder inside the package", () => {
    expect(resolveDataDir({})).toBe(join(PACKAGE_ROOT, "data"));
  });

  it("uses SUNLEAF_DATA_DIR, resolving a relative path from the package root", () => {
    expect(resolveDataDir({ SUNLEAF_DATA_DIR: "my-shop" })).toBe(join(PACKAGE_ROOT, "my-shop"));
    const absolute = makeDataDir({});
    expect(resolveDataDir({ SUNLEAF_DATA_DIR: absolute })).toBe(absolute);
  });

  it("loads your own folder and skips missing policies", () => {
    const dir = makeDataDir({
      "products.json": JSON.stringify([product]),
      "faqs.json": JSON.stringify([faq]),
      "policies/shipping.md": "# Shipping\n\n## Where\n\nEverywhere.",
    });
    const data = loadData(resolveDataDir({ SUNLEAF_DATA_DIR: dir }));
    expect(data.products.map((p) => p.id)).toEqual(["X-1"]);
    expect(Object.keys(data.policies)).toEqual(["shipping"]);
  });

  it("explains what is wrong with a malformed file", () => {
    const dir = makeDataDir({ "products.json": JSON.stringify([{ id: "X-1" }]), "faqs.json": "[]" });
    expect(() => loadData(dir)).toThrow(/products\.json does not match the expected format/);
  });

  it("rejects duplicate ids", () => {
    const dir = makeDataDir({ "products.json": JSON.stringify([product, product]), "faqs.json": "[]" });
    expect(() => loadData(dir)).toThrow(/duplicate id "X-1"/);
  });

  it("rejects an FAQ linked to a policy the folder does not have", () => {
    const dir = makeDataDir({
      "products.json": JSON.stringify([product]),
      "faqs.json": JSON.stringify([{ ...faq, policy: "wholesale" }]),
      "policies/shipping.md": "# Shipping\n\n## Where\n\nEverywhere.",
    });
    expect(() => loadData(dir)).toThrow(/FAQ "faq-x" names the wholesale policy, but policies\/wholesale\.md is missing/);
  });

  it("rejects an FAQ linked to a policy name that does not exist", () => {
    const dir = makeDataDir({
      "products.json": JSON.stringify([product]),
      "faqs.json": JSON.stringify([{ ...faq, policy: "refunds" }]),
    });
    expect(() => loadData(dir)).toThrow(/faqs\.json does not match the expected format/);
  });

  it("treats ids that differ only in case or spaces as duplicates", () => {
    const other = { ...product, id: " x-1 ", name: "Other Tea", price_usd: 10 };
    const dir = makeDataDir({ "products.json": JSON.stringify([product, other]), "faqs.json": "[]" });
    expect(() => loadData(dir)).toThrow(/duplicate id " x-1 "/);
  });
});
