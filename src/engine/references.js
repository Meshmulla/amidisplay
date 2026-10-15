// Finds spoken Bible references in transcript text.
// Handles "John 3:16", "John three sixteen", "John chapter 3 verse 16 to 18",
// "first Corinthians thirteen four", "Psalm 23", and follow-ups like "verse 17"
// or "look at verse twenty" that continue the last reference.

import { ALIASES, ALIAS_LIST, AMBIGUOUS, BOOK_NAMES } from "./books.js";
import { tokenize, mergeNumbers } from "./numbers.js";
import { repairBooks, NUMBER_SOUNDS } from "./hearing.js";

const MAX_ALIAS_WORDS = Math.max(...ALIAS_LIST.map((a) => a.split(" ").length));
const CHAPTER_WORDS = new Set(["chapter", "chapters", "chap", "ch", "chapta"]);
const VERSE_WORDS = new Set(["verse", "verses", "vs", "v", "vss", "vv", "versus", "vase", "vers", "vess"]);
const RANGE_WORDS = new Set(["-", "to", "through", "thru", "till", "until", "unto"]);
const FILLER = new Set(["from", "at", "and", "in", "the", "of"]);

/**
 * @param {string} text transcript text
 * @param {{books: {name:string, chapters:number[]}[]}} bible verse counts per chapter
 * @param {{book:number, chapter:number}|null} context last reference, used for "verse 17"
 * @returns {{refs: Ref[], context: object|null}}
 *
 * Ref = { book, chapter, verse, endVerse, kind, start, end }
 *   kind: "explicit" (book named), "chapter" (book + chapter only), "continuation" (verse only)
 *   start/end: character offsets of the spoken reference in `text`
 */
export function findReferences(text, bible, context = null) {
  const toks = repairBooks(mergeNumbers(tokenize(text)).map((t) => (t.t.endsWith("'s") ? { ...t, t: t.t.slice(0, -2) } : t)));
  const refs = [];
  let ctx = context;
  let i = 0;
  while (i < toks.length) {
    const book = matchBook(toks, i);
    if (book) {
      const r = parseAfterBook(toks, book.next, book.index, bible);
      if (r && (!book.ambiguous || r.hadNumberRightAway)) {
        r.ref.start = toks[i].start;
        refs.push(r.ref);
        ctx = { book: r.ref.book, chapter: r.ref.chapter };
        i = r.next;
        continue;
      }
    }
    if (ctx) {
      const c = parseContinuation(toks, i, ctx, bible);
      if (c) {
        refs.push(c.ref);
        ctx = { book: c.ref.book, chapter: c.ref.chapter };
        i = c.next;
        continue;
      }
    }
    i++;
  }
  return { refs, context: ctx };
}

function matchBook(toks, i) {
  for (let len = Math.min(MAX_ALIAS_WORDS, toks.length - i); len >= 1; len--) {
    const words = toks.slice(i, i + len);
    if (words.some((w) => /^[:\-.,;!?]$/.test(w.t))) continue;
    const key = words.map((w) => w.t).join(" ");
    if (ALIASES.has(key)) {
      return { index: ALIASES.get(key), next: i + len, ambiguous: AMBIGUOUS.has(key) };
    }
  }
  return null;
}

function num(tok) {
  return tok && typeof tok.n === "number" ? tok.n : null;
}

/** A number where one is clearly expected, allowing for sound-alikes ("verse for" -> 4). */
function slotNum(tok) {
  const n = num(tok);
  if (n !== null) return n;
  return tok && tok.t in NUMBER_SOUNDS ? NUMBER_SOUNDS[tok.t] : null;
}

function chapterCount(bible, b) {
  return bible.books[b].chapters.length;
}
function verseCount(bible, b, c) {
  return bible.books[b].chapters[c - 1] || 0;
}

function parseAfterBook(toks, j, book, bible) {
  let k = j;
  let sawChapterWord = false;
  // "John, chapter 3", "John chapter three"
  while (toks[k] && (toks[k].t === "," || FILLER.has(toks[k].t))) k++;
  if (toks[k] && CHAPTER_WORDS.has(toks[k].t)) { sawChapterWord = true; k++; }
  const hadNumberRightAway = num(toks[j]) !== null || toks[j]?.t === "tree" || sawChapterWord;
  let chapter = sawChapterWord ? slotNum(toks[k]) : toks[k]?.t === "tree" ? 3 : num(toks[k]);
  if (chapter === null) return null;
  let chapEnd = toks[k].end;
  k++;

  // Speech engines sometimes write "John 316" for "John 3:16".
  if (chapter > chapterCount(bible, book) && !sawChapterWord && chapter >= 10) {
    const s = String(chapter);
    for (let cut = 1; cut < s.length; cut++) {
      const c = Number(s.slice(0, cut));
      const v = Number(s.slice(cut));
      if (c >= 1 && c <= chapterCount(bible, book) && v >= 1 && v <= verseCount(bible, book, c)) {
        const ref = { book, chapter: c, verse: v, endVerse: v, kind: "explicit", end: chapEnd };
        const r = parseRange(toks, k, ref, bible);
        return { ref: r.ref, next: r.next, hadNumberRightAway: true };
      }
    }
    return null;
  }
  if (chapter < 1 || chapter > chapterCount(bible, book)) return null;

  // Verse part: ":16", "verse 16", "16", "and verse 16", "from verse 16"
  let v = k;
  let sawVerseWord = false;
  if (toks[v] && toks[v].t === ":") v++;
  else {
    while (toks[v] && (toks[v].t === "," || FILLER.has(toks[v].t))) v++;
    if (toks[v] && VERSE_WORDS.has(toks[v].t)) { sawVerseWord = true; v++; }
    else v = k; // bare number directly after chapter: "John 3 16"
  }
  const verse = sawVerseWord || toks[v - 1]?.t === ":" ? slotNum(toks[v]) : toks[v]?.t === "tree" ? 3 : num(toks[v]);
  if (verse !== null && verse >= 1 && verse <= verseCount(bible, book, chapter) && (sawVerseWord || v === k || toks[v - 1].t === ":")) {
    const ref = { book, chapter, verse, endVerse: verse, kind: "explicit", end: toks[v].end };
    const r = parseRange(toks, v + 1, ref, bible);
    return { ref: r.ref, next: r.next, hadNumberRightAway };
  }
  return {
    ref: { book, chapter, verse: 1, endVerse: 1, kind: "chapter", end: chapEnd },
    next: k,
    hadNumberRightAway,
  };
}

function parseRange(toks, k, ref, bible) {
  // "16 to 18", "16-18", "16 and 17", "16 through verse 18"
  const t = toks[k];
  if (t && (RANGE_WORDS.has(t.t) || t.t === "and")) {
    let m = k + 1;
    if (toks[m] && VERSE_WORDS.has(toks[m].t)) m++;
    const e = num(toks[m]);
    const max = verseCount(bible, ref.book, ref.chapter);
    if (e !== null && e > ref.verse && e <= max && e - ref.verse <= 30) {
      ref.endVerse = e;
      ref.end = toks[m].end;
      return { ref, next: m + 1 };
    }
  }
  return { ref, next: k };
}

function parseContinuation(toks, i, ctx, bible) {
  const t = toks[i];
  // "chapter 4 verse 2" with no book: stay in the same book
  if (CHAPTER_WORDS.has(t.t)) {
    const c = num(toks[i + 1]);
    if (c === null || c < 1 || c > chapterCount(bible, ctx.book)) return null;
    let v = i + 2;
    if (toks[v] && toks[v].t === ":") v++;
    else {
      while (toks[v] && FILLER.has(toks[v].t)) v++;
      if (toks[v] && VERSE_WORDS.has(toks[v].t)) v++;
      else return null; // "chapter 4" alone is too vague mid-sermon
    }
    const verse = num(toks[v]);
    if (verse === null || verse < 1 || verse > verseCount(bible, ctx.book, c)) return null;
    const ref = { book: ctx.book, chapter: c, verse, endVerse: verse, kind: "continuation", start: t.start, end: toks[v].end };
    const r = parseRange(toks, v + 1, ref, bible);
    return { ref: r.ref, next: r.next };
  }
  // "verse 17", "verses 17 and 18"
  if (VERSE_WORDS.has(t.t) && t.t !== "v") {
    const verse = num(toks[i + 1]);
    if (verse === null || verse < 1 || verse > verseCount(bible, ctx.book, ctx.chapter)) return null;
    const ref = { book: ctx.book, chapter: ctx.chapter, verse, endVerse: verse, kind: "continuation", start: t.start, end: toks[i + 1].end };
    const r = parseRange(toks, i + 2, ref, bible);
    return { ref: r.ref, next: r.next };
  }
  return null;
}

export function formatRef(ref) {
  const name = BOOK_NAMES[ref.book];
  const n = name === "Psalms" ? "Psalm" : name;
  if (ref.kind === "chapter") return `${n} ${ref.chapter}`;
  const tail = ref.endVerse && ref.endVerse !== ref.verse ? `–${ref.endVerse}` : "";
  return `${n} ${ref.chapter}:${ref.verse}${tail}`;
}

/** Parse something an operator types: "jn 3 16", "1 cor 13:4-7", "psalm 23". */
export function parseTypedReference(text, bible) {
  const { refs } = findReferences(text.replace(/\./g, " "), bible, null);
  return refs.find((r) => r.kind !== "continuation") || null;
}
