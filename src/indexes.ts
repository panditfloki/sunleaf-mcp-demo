import { POLICY_LABELS, POLICY_NAMES, type Faq, type PolicyName, type Product, type SunleafData } from "./data.js";
import { SearchIndex, type SearchDoc } from "./search.js";

/** A citable piece of text: one FAQ, or one section of a policy. */
export interface Passage {
  /** The id to cite, for example "faq-006" or "policy:returns#opened-tins". */
  id: string;
  title: string;
  text: string;
}

export function productIndex(products: Product[]): SearchIndex<Product> {
  return new SearchIndex(
    products.map((product) => ({
      id: product.id,
      item: product,
      fields: [
        { text: product.name, weight: 3 },
        { text: product.tags.join(" "), weight: 2 },
        { text: product.category, weight: 2 },
        { text: product.short_description, weight: 1 },
      ],
    })),
  );
}

export function faqIndex(faqs: Faq[]): SearchIndex<Faq> {
  return new SearchIndex(
    faqs.map((faq) => ({
      id: faq.id,
      item: faq,
      fields: [
        { text: faq.question, weight: 3 },
        { text: faq.tags.join(" "), weight: 2 },
        { text: faq.answer, weight: 1 },
      ],
    })),
  );
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Split a policy into one passage per "## " section, so a citation points at the part that
 * answers the question rather than at the whole document. The title line and the
 * sample-data note before the first section are not passages.
 */
export function policyPassages(name: PolicyName, markdown: string): Passage[] {
  const [intro = "", ...sections] = markdown.split(/^## /m);
  const passages: Passage[] = [];

  const introText = intro
    .split("\n")
    .filter((line) => !line.startsWith("# ") && !/sample policy/i.test(line))
    .join("\n")
    .trim();
  if (introText) passages.push({ id: `policy:${name}`, title: POLICY_LABELS[name], text: introText });

  for (const section of sections) {
    const newline = section.indexOf("\n");
    const heading = (newline === -1 ? section : section.slice(0, newline)).trim();
    const body = newline === -1 ? "" : section.slice(newline + 1).trim();
    if (!heading || !body) continue;
    passages.push({ id: `policy:${name}#${slug(heading)}`, title: `${POLICY_LABELS[name]}: ${heading}`, text: body });
  }
  return passages;
}

/** FAQs and policy sections in one index, for answer_sources. */
export function passageIndex(data: SunleafData): SearchIndex<Passage> {
  const docs: SearchDoc<Passage>[] = data.faqs.map((faq) => ({
    id: faq.id,
    item: { id: faq.id, title: faq.question, text: faq.answer },
    fields: [
      { text: faq.question, weight: 3 },
      { text: faq.tags.join(" "), weight: 2 },
      { text: faq.answer, weight: 1 },
    ],
  }));

  for (const name of POLICY_NAMES) {
    const markdown = data.policies[name];
    if (markdown === undefined) continue;
    for (const passage of policyPassages(name, markdown)) {
      docs.push({
        id: passage.id,
        item: passage,
        fields: [
          { text: passage.title, weight: 3 },
          { text: `${name} policy`, weight: 2 },
          { text: passage.text, weight: 1 },
        ],
      });
    }
  }
  return new SearchIndex(docs);
}
