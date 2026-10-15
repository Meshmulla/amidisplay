// Turns spoken numbers into digits: "one hundred and nineteen" -> 119, "twenty-three" -> 23.
// Works on token arrays so the reference parser can keep track of where things were said.

const SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
  // as often heard from West African English speakers by speech engines
  tirteen: 13, fourtheen: 14, tree: 3,
};
const TENS = { twenty: 20, thirty: 30, tirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Split text into tokens with character offsets. Keeps ":" and "-" as their own tokens. */
export function tokenize(text) {
  const tokens = [];
  const re = /[A-Za-z0-9]+(?:'[A-Za-z]+)?|[:\-–—]|[.,;!?]/g;
  let m;
  while ((m = re.exec(text))) {
    let t = m[0].toLowerCase();
    if (t === "–" || t === "—") t = "-";
    tokens.push({ t, start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function kind(t) {
  if (t in SMALL) return SMALL[t] < 10 ? "unit" : "teen";
  if (t in TENS) return "tens";
  if (t === "hundred") return "hundred";
  return null;
}

/**
 * Merge runs of number words into numeric tokens ({ t: "119", n: 119 }).
 * "three sixteen" stays two numbers; "twenty three" becomes one.
 * Digit tokens also get an `n` field.
 */
export function mergeNumbers(tokens) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const k = kind(tok.t);
    const nextK = tokens[i + 1] ? kind(tokens[i + 1].t) : null;
    if (!k) {
      // "one hundred and nineteen", "twenty-three"
      if (cur && tok.t === "and" && cur.last === "hundred" && nextK) continue;
      if (cur && tok.t === "-" && cur.last === "tens" && nextK === "unit") continue;
      flush();
      if (/^\d+$/.test(tok.t)) out.push({ ...tok, n: Number(tok.t) });
      else out.push(tok);
      continue;
    }
    if (tok.t === "tree" && !(cur && cur.last === "tens")) { flush(); out.push(tok); continue; }
    const v = tok.t in SMALL ? SMALL[tok.t] : tok.t in TENS ? TENS[tok.t] : 100;
    if (cur && k === "unit" && v > 0 && cur.last === "tens") { cur.n += v; cur.last = "unit"; }
    else if (cur && k !== "hundred" && cur.last === "hundred" && cur.n % 100 === 0) { cur.n += v; cur.last = k; }
    else if (cur && k === "hundred" && cur.n < 10) { cur.n *= 100; cur.last = "hundred"; }
    else { flush(); cur = { t: "", n: v, start: tok.start, end: tok.end, last: k }; }
    cur.end = tok.end;
    cur.t = String(cur.n);
  }
  flush();
  return out;
}

/** Convenience for tests and search boxes: "john three sixteen" -> "john 3 16". */
export function wordsToDigits(text) {
  return mergeNumbers(tokenize(text)).map((t) => t.t).join(" ");
}
