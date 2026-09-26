import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.js";
import { faqIndex, passageIndex, policyPassages, productIndex } from "../src/indexes.js";
import { SearchIndex, stem, tokenize } from "../src/search.js";
import { MIN_ANSWER_COVERAGE } from "../src/server.js";

const data = loadData();

describe("tokenize", () => {
  it("drops common words and trims word endings", () => {
    expect(tokenize("Do you ship to Canada?")).toEqual(["ship", "canada"]);
    expect(tokenize("Caffeine-free teas")).toEqual(["caffein", "free", "tea"]);
  });

  it("maps a word and its common forms to the same stem", () => {
    expect(stem("shipping")).toBe(stem("ship"));
    expect(stem("shipped")).toBe(stem("ships"));
    expect(stem("boxes")).toBe("box");
    expect(stem("glasses")).toBe("glass");
    expect(stem("policies")).toBe("policy");
    expect(stem("opened")).toBe("open");
    expect(stem("delivery")).toBe(stem("delivered"));
  });
});

describe("product search", () => {
  const index = productIndex(data.products);

  it('ranks green teas first for "green tea"', () => {
    const greenTeas = data.products.filter((product) => product.category === "green tea").length;
    const top = index.search("green tea").slice(0, greenTeas);
    expect(top).toHaveLength(greenTeas);
    for (const hit of top) expect(hit.item.category).toBe("green tea");
  });

  it("can leave out products that are out of stock", () => {
    const all = index.search("green");
    expect(all.some((hit) => !hit.item.in_stock)).toBe(true);
    const inStock = index.search("green", { filter: (product) => product.in_stock });
    expect(inStock.length).toBeGreaterThan(0);
    expect(inStock.every((hit) => hit.item.in_stock)).toBe(true);
  });

  it("finds caffeine-free products", () => {
    const hits = index.search("caffeine-free", { limit: 5 });
    expect(hits).toHaveLength(5);
    for (const hit of hits) expect(hit.item.tags).toContain("caffeine-free");
  });

  it("returns nothing for words that are not in the catalog", () => {
    expect(index.search("motorbike")).toEqual([]);
  });

  it("breaks score ties by id, so results are stable", () => {
    const tied = new SearchIndex([
      { id: "b", item: "b", fields: [{ text: "tea", weight: 1 }] },
      { id: "a", item: "a", fields: [{ text: "tea", weight: 1 }] },
    ]);
    expect(tied.search("tea").map((hit) => hit.id)).toEqual(["a", "b"]);
  });
});

describe("FAQ search", () => {
  it("finds the Darjeeling brewing answer", () => {
    const [top] = faqIndex(data.faqs).search("How should I brew the Darjeeling first flush?");
    expect(top?.item.id).toBe("faq-010");
  });
});

describe("answer sources", () => {
  const index = passageIndex(data);

  it("finds the returns policy for opened tins", () => {
    const hits = index.search("What is your return policy for opened tins?", { minCoverage: MIN_ANSWER_COVERAGE });
    expect(hits.map((hit) => hit.id)).toContain("policy:returns#opened-tins");
  });

  it("rates Canada below the full-match bar but still finds the shipping list", () => {
    const hits = index.search("Do you ship to Canada?");
    expect(hits.map((hit) => hit.id)).toContain("faq-001");
    expect(hits.every((hit) => hit.coverage < MIN_ANSWER_COVERAGE)).toBe(true);
  });

  it("splits a policy into citable sections and marks the first as its scope", () => {
    const passages = policyPassages("returns", data.policies.returns ?? "");
    expect(passages.map((passage) => passage.id)).toContain("policy:returns#opened-tins");
    expect(passages.every((passage) => !/sample policy/i.test(passage.text))).toBe(true);
    expect(passages.filter((passage) => passage.scope).map((passage) => passage.id)).toEqual([
      "policy:returns#what-can-be-returned",
    ]);
  });
});
