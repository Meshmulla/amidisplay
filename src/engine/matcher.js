// Matches what was said against every verse, in three translations at once,
// and reports the KJV verse it most likely is.
//
// Two kinds of evidence:
//   1. Shared words (BM25 over stemmed content words, synonyms folded)
//   2. Shared phrases (three-word shingles, stopwords kept) — catches short quotes like
//      "I can do all things" that are mostly common words.
// KJV, BSB and NHEB wording are all indexed against the same verse, so a preacher quoting
// a modern translation, or paraphrasing, still lands on the right KJV verse.

import { contentStems, phraseStems, hash32 } from "./text.js";
import { POPULAR } from "./popular.js";
import { parseTypedReference } from "./references.js";

const VERSIONS = ["kjv", "bsb", "nheb"];
const K1 = 1.2;
const B = 0.4;
const SHINGLE = 3;
const ID_SPACE = 32768; // verse ids fit in 15 bits

function shingles(stems) {
  const out = new Set();
  for (let i = 0; i + SHINGLE <= stems.length; i++) out.add(hash32(stems.slice(i, i + SHINGLE).join(" ")));
  return out;
}

export class Matcher {
  constructor(bible) {
    this.bible = bible;
    const n = bible.size;
    if (n >= ID_SPACE) throw new Error("verse ids exceed index space");
    const postings = new Map(); // term -> [ids..., tfs...]
    const docLen = new Float32Array(n);
    const keys = [];
    for (let i = 0; i < n; i++) {
      const tf = new Map();
      const grams = new Set();
      for (const v of VERSIONS) {
        const t = bible.text(i, v);
        if (!t) continue;
        const local = new Map();
        for (const s of contentStems(t)) local.set(s, (local.get(s) || 0) + 1);
        for (const [s, c] of local) tf.set(s, Math.max(tf.get(s) || 0, c));
        for (const g of shingles(phraseStems(t))) grams.add(g);
      }
      let len = 0;
      for (const [s, c] of tf) {
        let p = postings.get(s);
        if (!p) postings.set(s, (p = []));
        p.push(i, c);
        len += c;
      }
      docLen[i] = len;
      for (const g of grams) keys.push(g * ID_SPACE + i);
    }
    this.avgLen = docLen.reduce((a, b) => a + b, 0) / n;
    this.docLen = docLen;
    this.idf = new Map();
    this.post = new Map();
    for (const [s, p] of postings) {
      const df = p.length / 2;
      this.idf.set(s, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
      this.post.set(s, Int32Array.from(p));
    }
    this.grams = Float64Array.from(keys).sort();
    this.popular = new Set();
    for (const m of POPULAR.matchAll(/((?:\d )?[A-Z][a-z]+(?: of [A-Z][a-z]+)?) (\d+):(\d+)/g)) {
      const r = parseTypedReference(`${m[1]} ${m[2]}:${m[3]}`, bible);
      if (r) this.popular.add(bible.index(r.book, r.chapter, r.verse));
    }
    this.scores = new Float32Array(n);
    this.hits = new Uint8Array(n);
  }

  idfOf(s) {
    return this.idf.get(s) ?? Math.log(1 + this.bible.size);
  }

  gramRange(g) {
    const lo = g * ID_SPACE, hi = lo + ID_SPACE;
    const a = this.grams;
    let l = 0, r = a.length;
    while (l < r) { const m = (l + r) >> 1; if (a[m] < lo) l = m + 1; else r = m; }
    const out = [];
    for (let k = l; k < a.length && a[k] < hi; k++) out.push(a[k] - lo);
    return out;
  }

  /**
   * @param {string} said recent transcript text (a window of ~20–40 words)
   * @param {number} limit how many candidates to return
   * @returns {{index:number, score:number, confidence:number, version:string, matched:string[]}[]}
   */
  match(said, limit = 3) {
    const qStems = [...new Set(contentStems(said))];
    const qGrams = shingles(phraseStems(said));
    if (qStems.length < 2 && qGrams.size < 2) return [];
    const { scores, hits, docLen, avgLen } = this;
    scores.fill(0);
    hits.fill(0);
    const touched = new Set();
    for (const s of qStems) {
      const p = this.post.get(s);
      if (!p) continue;
      const idf = this.idfOf(s);
      for (let k = 0; k < p.length; k += 2) {
        const i = p[k], tf = p[k + 1];
        scores[i] += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * docLen[i] / avgLen));
        touched.add(i);
      }
    }
    for (const g of qGrams) {
      for (const i of this.gramRange(g)) {
        if (hits[i] < 255) hits[i]++;
        touched.add(i);
      }
    }
    // Rough ranking first, then a careful look at the best few.
    const rough = [];
    for (const i of touched) rough.push([i, scores[i] + 2.2 * hits[i]]);
    rough.sort((a, b) => b[1] - a[1]);
    const top = rough.slice(0, 30);
    const qSet = new Set(qStems);
    const qPhrase = phraseStems(said);
    const detailed = top.map(([i, base]) => {
      let best = null;
      for (const v of VERSIONS) {
        const t = this.bible.text(i, v);
        if (!t) continue;
        const f = this.features(t, qSet, qPhrase);
        f.version = v;
        if (!best || f.fit > best.fit) best = f;
      }
      const pop = this.popular.has(i) ? 1.12 : 1;
      return { index: i, base, ...best, score: base * (0.3 + best.fit) * pop };
    });
    detailed.sort((a, b) => b.score - a.score);
    return detailed.slice(0, limit).map((d, rank) => {
      const other = rank === 0 ? detailed[1]?.score || 0 : detailed[0].score;
      const margin = d.score > 0 ? (d.score - other) / d.score : 0;
      let confidence = d.fit + (rank === 0 ? Math.max(0, margin) * 0.15 : -0.1);
      confidence = Math.max(0, Math.min(1, confidence));
      return {
        index: d.index, score: d.score, confidence, version: d.version, matched: d.matched,
        coverage: d.cov, run: d.run, evidence: d.evidence,
      };
    });
  }

  /**
   * How well one translation of a verse fits what was said.
   *  cov      share of the verse's meaningful words (weighted by rarity) that were said
   *  evidence total rarity of the words that matched — common words like "Lord" count little
   *  run      longest stretch said word-for-word, counted in meaningful words
   */
  features(verseText, qSet, qPhrase) {
    const stems = [...new Set(contentStems(verseText))];
    let have = 0, total = 0;
    const matched = [];
    for (const s of stems) {
      const w = this.idfOf(s);
      total += w;
      if (qSet.has(s)) { have += w; matched.push(s); }
    }
    const cov = total ? have / total : 0;
    // Longest common run of words (stopwords included), scored by the content words inside it.
    const vp = phraseStems(verseText);
    let run = 0, runLen = 0;
    const prev = new Uint16Array(vp.length + 1);
    const prevC = new Float32Array(vp.length + 1);
    for (let a = 0; a < qPhrase.length; a++) {
      const curr = new Uint16Array(vp.length + 1);
      const currC = new Float32Array(vp.length + 1);
      for (let b = 0; b < vp.length; b++) {
        if (qPhrase[a] === vp[b]) {
          curr[b + 1] = prev[b] + 1;
          currC[b + 1] = prevC[b] + (qSet.has(vp[b]) ? 1 : 0.25);
          if (currC[b + 1] > run) { run = currC[b + 1]; runLen = curr[b + 1]; }
        }
      }
      prev.set(curr);
      prevC.set(currC);
    }
    const evidence = have;
    // Word overlap alone is never treated as certain; it needs several meaningful words.
    const countFactor = Math.min(1, Math.max(0, (matched.length - 1.5) / 3.5));
    const wordScore = 0.85 * cov * countFactor;
    // A word-for-word stretch is strong evidence of a quote.
    const runScore = runLen >= 3 ? Math.min(1, Math.max(0, (run - 2.5) / 4)) : 0;
    const fit = Math.min(1, Math.max(runScore, wordScore) + 0.35 * Math.min(runScore, wordScore));
    return { cov, evidence, run, runLen, fit, matched };
  }
}
