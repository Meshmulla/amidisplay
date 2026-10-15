// Canonical book list (KJV order) with the ways people say and speech engines write them.

export const BOOK_NAMES = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah",
  "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum",
  "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
  "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
  "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
];

// Extra spoken/written forms per book index. Numbered books get their prefixes generated below.
const EXTRA = {
  0: ["gen", "gn"], 1: ["exod", "ex"], 2: ["lev"], 3: ["num"], 4: ["deut", "deu", "deuteronomy"],
  5: ["josh"], 6: ["judg"], 17: ["job"], 18: ["psalm", "psalms", "ps", "psa", "the psalms", "the psalm", "palm", "palms"],
  19: ["prov", "proverb", "the proverbs"], 20: ["eccl", "eccles", "ecclesiastics", "the preacher"],
  21: ["song of songs", "songs of solomon", "song of solomon", "song of sol", "songs", "canticles", "song of song"],
  22: ["isa", "isiah", "isaih"], 23: ["jer"], 24: ["lam"], 25: ["ezek", "ezekial"], 26: ["dan"],
  27: ["hos"], 30: ["obad"], 32: ["mic"], 34: ["hab", "habakuk"], 35: ["zeph"], 36: ["hag"],
  37: ["zech", "zachariah"], 38: ["mal"], 39: ["matt", "mathew", "mat"], 40: ["mk"], 41: ["lk"],
  42: ["jn", "jhn"], 43: ["the acts", "acts of the apostles", "act", "the acts of the apostles"],
  44: ["rom"], 47: ["gal", "galatian"], 48: ["eph", "ephesian"], 49: ["phil", "philippian", "phillipians", "philipians", "phillippians"],
  50: ["col", "colossian"], 55: ["tit"], 56: ["philem", "phlm"], 57: ["heb", "hebrew"],
  58: ["jas", "jame"], 64: ["jud"], 65: ["revelations", "rev", "the revelation", "revelation of john", "book of revelation"],
};

const ORD = {
  1: ["1", "1st", "first", "i", "one"],
  2: ["2", "2nd", "second", "ii", "two"],
  3: ["3", "3rd", "third", "iii", "three"],
};

function norm(s) {
  return s.toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

/** Map of normalised alias -> book index. */
export const ALIASES = new Map();

BOOK_NAMES.forEach((name, i) => {
  const m = name.match(/^(\d) (.+)$/);
  if (m) {
    const n = Number(m[1]);
    const base = m[2].toLowerCase();
    const bases = [base];
    if (base === "corinthians") bases.push("cor", "corinthian");
    if (base === "thessalonians") bases.push("thess", "thessalonian", "thes");
    if (base === "timothy") bases.push("tim");
    if (base === "samuel") bases.push("sam");
    if (base === "kings") bases.push("king", "kgs");
    if (base === "chronicles") bases.push("chron", "chronicle", "chr");
    if (base === "peter") bases.push("pet");
    if (base === "john") bases.push("jn");
    for (const p of ORD[n]) for (const b of bases) {
      ALIASES.set(norm(`${p} ${b}`), i);
    }
  } else {
    ALIASES.set(norm(name), i);
  }
  for (const a of EXTRA[i] || []) ALIASES.set(norm(a), i);
});

// Short aliases that are also ordinary English words; only accepted when followed by digits.
export const AMBIGUOUS = new Set(["job", "acts", "act", "mark", "numbers", "num", "songs", "ex", "col", "hag", "dan", "mal", "lam", "jud", "tit", "hos", "mic", "heb", "rom", "gal", "jas", "jame", "phil", "lk", "mk", "ps", "psa", "palm", "palms", "the preacher", "one john", "two john", "three john", "one peter", "two peter", "i john", "i peter", "i kings", "i samuel", "i chronicles", "i corinthians", "i thessalonians", "i timothy"]);

/** Aliases sorted longest-first so "1 john" wins over "john". */
export const ALIAS_LIST = [...ALIASES.keys()].sort((a, b) => b.length - a.length);

export function bookName(i) {
  return BOOK_NAMES[i];
}
