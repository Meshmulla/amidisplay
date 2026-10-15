import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Bible } from "../src/engine/bible.js";
import { Matcher } from "../src/engine/matcher.js";
import { parseTypedReference } from "../src/engine/references.js";
import { SUGGEST_AT } from "../src/engine/thresholds.js";
import { QUOTES, NOISE } from "./fixtures.js";

const bible = new Bible(JSON.parse(fs.readFileSync(new URL("../data/bible.json", import.meta.url), "utf8")));
const matcher = new Matcher(bible);

test("quotes and paraphrases land on the right KJV verse", () => {
  const misses = [];
  for (const [said, expected] of QUOTES) {
    const wants = expected.split("|").map((e) => {
      const r = parseTypedReference(e, bible);
      return bible.index(r.book, r.chapter, r.verse);
    });
    const top = matcher.match(said, 1)[0];
    if (!top || !wants.includes(top.index) || top.confidence < SUGGEST_AT) misses.push(`${expected} <- "${said}"`);
  }
  assert.deepEqual(misses, []);
});

test("ordinary sermon talk stays below the suggestion threshold", () => {
  const loud = NOISE.filter((said) => (matcher.match(said, 1)[0]?.confidence || 0) >= SUGGEST_AT);
  assert.deepEqual(loud, []);
});
