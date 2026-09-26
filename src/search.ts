/**
 * A small keyword search, written for this demo so it works offline with no services.
 *
 * Text is lowercased and split into words, common words are dropped and word endings are
 * trimmed ("teas" -> "tea", "shipping" -> "ship"). A document earns points for each query
 * word it contains: more for a word in its name or question (x3) than in its tags (x2) or
 * body text (x1), and more for rare words than for words that appear everywhere.
 */

const STOPWORDS = new Set([
  "a", "about", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be", "been",
  "but", "by", "can", "could", "did", "do", "does", "for", "from", "get", "had", "has",
  "have", "how", "i", "if", "in", "into", "is", "it", "its", "just", "know", "like", "me",
  "my", "need", "no", "not", "of", "on", "or", "our", "please", "should", "so", "some",
  "tell", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this",
  "those", "to", "us", "want", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
]);

/** Drop a doubled final consonant left behind by a trimmed ending: "shipp" -> "ship". */
function undouble(word: string): string {
  return /([bdfgmnprt])\1$/.test(word) ? word.slice(0, -1) : word;
}

/** A deliberately light stemmer. It only has to map a word and its common forms to the same key. */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;
  if (w.length > 4 && w.endsWith("ies")) {
    w = `${w.slice(0, -3)}y`;
  } else if (/(?:ss|x|z|ch|sh)es$/.test(w)) {
    w = w.slice(0, -2);
  } else if (w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) {
    w = w.slice(0, -1);
  }
  if (w.length > 5 && w.endsWith("ing")) {
    w = undouble(w.slice(0, -3));
  } else if (w.length > 4 && w.endsWith("ed")) {
    w = undouble(w.slice(0, -2));
  }
  if (w.length > 4 && w.endsWith("e")) {
    w = w.slice(0, -1);
  }
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

export interface Field {
  text: string;
  weight: number;
}

export interface SearchDoc<T> {
  id: string;
  item: T;
  fields: Field[];
}

export interface SearchHit<T> {
  id: string;
  item: T;
  score: number;
  /** Share of the query's words (weighted by rarity) that this document contains, 0 to 1. */
  coverage: number;
  matched: string[];
}

export interface SearchOptions<T> {
  limit?: number;
  filter?: (item: T) => boolean;
  /** Drop hits whose coverage is below this value. */
  minCoverage?: number;
}

interface IndexedDoc<T> {
  id: string;
  item: T;
  fields: { terms: Set<string>; weight: number }[];
}

export class SearchIndex<T> {
  private readonly docs: IndexedDoc<T>[];
  private readonly docFreq = new Map<string, number>();

  constructor(docs: SearchDoc<T>[]) {
    this.docs = docs.map((doc) => ({
      id: doc.id,
      item: doc.item,
      fields: doc.fields.map((field) => ({ terms: new Set(tokenize(field.text)), weight: field.weight })),
    }));
    for (const doc of this.docs) {
      const terms = new Set(doc.fields.flatMap((field) => [...field.terms]));
      for (const term of terms) this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }
  }

  /** Rarer words count more. A word that no document contains gets the highest weight. */
  idf(term: string): number {
    const docFreq = this.docFreq.get(term) ?? 0;
    return Math.log(1 + (this.docs.length + 1) / (docFreq + 0.5));
  }

  search(query: string, options: SearchOptions<T> = {}): SearchHit<T>[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const totalWeight = terms.reduce((sum, term) => sum + this.idf(term), 0);

    const hits: SearchHit<T>[] = [];
    for (const doc of this.docs) {
      if (options.filter && !options.filter(doc.item)) continue;
      let score = 0;
      let matchedWeight = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const fieldWeight = doc.fields.reduce((sum, field) => sum + (field.terms.has(term) ? field.weight : 0), 0);
        if (fieldWeight === 0) continue;
        const idf = this.idf(term);
        score += idf * fieldWeight;
        matchedWeight += idf;
        matched.push(term);
      }
      if (score === 0) continue;
      const coverage = matchedWeight / totalWeight;
      if (options.minCoverage !== undefined && coverage < options.minCoverage) continue;
      hits.push({ id: doc.id, item: doc.item, score, coverage, matched });
    }

    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return options.limit === undefined ? hits : hits.slice(0, options.limit);
  }
}
