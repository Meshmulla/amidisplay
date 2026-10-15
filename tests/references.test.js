import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findReferences, formatRef, parseTypedReference } from "../src/engine/references.js";
import { wordsToDigits } from "../src/engine/numbers.js";

const bible = JSON.parse(fs.readFileSync(new URL("../data/bible.json", import.meta.url), "utf8"));
const refs = (text, ctx = null) => findReferences(text, bible, ctx).refs.map(formatRef);

test("spoken numbers become digits", () => {
  assert.equal(wordsToDigits("john three sixteen"), "john 3 16");
  assert.equal(wordsToDigits("psalm one hundred and nineteen verse one hundred and five"), "psalm 119 verse 105");
  assert.equal(wordsToDigits("twenty-three"), "23");
  assert.equal(wordsToDigits("chapter twenty three verse four"), "chapter 23 verse 4");
});

test("common written and spoken forms", () => {
  assert.deepEqual(refs("turn with me to John 3:16"), ["John 3:16"]);
  assert.deepEqual(refs("John three sixteen says"), ["John 3:16"]);
  assert.deepEqual(refs("John chapter 3 verse 16"), ["John 3:16"]);
  assert.deepEqual(refs("John chapter three from verse sixteen to eighteen"), ["John 3:16–18"]);
  assert.deepEqual(refs("Romans 8 28"), ["Romans 8:28"]);
  assert.deepEqual(refs("first Corinthians thirteen verse four"), ["1 Corinthians 13:4"]);
  assert.deepEqual(refs("1st John 4:8"), ["1 John 4:8"]);
  assert.deepEqual(refs("second Timothy one seven"), ["2 Timothy 1:7"]);
  assert.deepEqual(refs("Psalm 23"), ["Psalm 23"]);
  assert.deepEqual(refs("Psalms 119:105"), ["Psalm 119:105"]);
  assert.deepEqual(refs("Song of Solomon 2:4"), ["Song of Solomon 2:4"]);
  assert.deepEqual(refs("Revelations 12:11"), ["Revelation 12:11"]);
  assert.deepEqual(refs("Philippians 4 verses 6 and 7"), ["Philippians 4:6–7"]);
  assert.deepEqual(refs("Isaiah 40:29-31"), ["Isaiah 40:29–31"]);
});

test("speech engine run-together numbers", () => {
  assert.deepEqual(refs("John 316"), ["John 3:16"]);
  assert.deepEqual(refs("Jeremiah 2911"), ["Jeremiah 29:11"]);
});

test("follow-ups continue the last reference", () => {
  assert.deepEqual(refs("John 3:16. Now look at verse 17"), ["John 3:16", "John 3:17"]);
  assert.deepEqual(refs("verse eighteen", { book: 42, chapter: 3 }), ["John 3:18"]);
  assert.deepEqual(refs("go to chapter 4 verse 2", { book: 42, chapter: 3 }), ["John 4:2"]);
});

test("ordinary speech is left alone", () => {
  assert.deepEqual(refs("I want to mark this moment"), []);
  assert.deepEqual(refs("the acts of kindness we show"), []);
  assert.deepEqual(refs("John the Baptist said repent"), []);
  assert.deepEqual(refs("he had one job"), []);
  assert.deepEqual(refs("in the next verse he says"), []);
  assert.deepEqual(refs("Jude 99"), []); // Jude has one chapter
  assert.deepEqual(refs("John 3:99"), ["John 3"]); // invalid verse falls back to the chapter
});

test("typed search", () => {
  assert.equal(formatRef(parseTypedReference("jn 3 16", bible)), "John 3:16");
  assert.equal(formatRef(parseTypedReference("1 cor 13:4-7", bible)), "1 Corinthians 13:4–7");
  assert.equal(formatRef(parseTypedReference("ps 23", bible)), "Psalm 23");
  assert.equal(formatRef(parseTypedReference("Phil. 4:13", bible)), "Philippians 4:13");
});

test("misheard book names are repaired when a reference follows", () => {
  assert.deepEqual(refs("Philippines 4:13"), ["Philippians 4:13"]);
  assert.deepEqual(refs("turn to a fusions chapter 6 verse 10"), ["Ephesians 6:10"]);
  assert.deepEqual(refs("Isaiah's 53:5"), ["Isaiah 53:5"]);
  assert.deepEqual(refs("is equal 37 verse 4"), ["Ezekiel 37:4"]);
  assert.deepEqual(refs("have a cook 2:3"), ["Habakkuk 2:3"]);
  assert.deepEqual(refs("Filipians 4 6"), ["Philippians 4:6"]); // sound-alike
  assert.deepEqual(refs("Colosians 3:23"), ["Colossians 3:23"]); // sound-alike
  assert.deepEqual(refs("Romance 8:28"), ["Romans 8:28"]);
  assert.deepEqual(refs("Revolution 12 verse 11"), ["Revelation 12:11"]);
});

test("misheard words stay alone in ordinary speech", () => {
  assert.deepEqual(refs("I travelled to the Philippines last year"), []);
  assert.deepEqual(refs("this is not a romance 2 story"), []); // risky word needs chapter and verse
  assert.deepEqual(refs("the revolution 2 years ago"), []);
  assert.deepEqual(refs("it is equal to the task"), []);
});

test("accented and sound-alike numbers", () => {
  assert.deepEqual(refs("John chapter tree verse sixteen"), ["John 3:16"]);
  assert.deepEqual(refs("John tree sixteen"), ["John 3:16"]);
  assert.deepEqual(refs("Psalm twenty tree"), ["Psalm 23"]);
  assert.deepEqual(refs("Hebrews 11 verse for"), ["Hebrews 11:4"]);
  assert.deepEqual(refs("Psalm one hundred and tirty tree verse one"), ["Psalm 133:1"]);
  assert.deepEqual(refs("Romans 8 versus 28"), ["Romans 8:28"]);
  assert.deepEqual(refs("the tree of life in Genesis"), []);
  assert.deepEqual(refs("verses to remember", { book: 42, chapter: 3 }), []);
});

test("what offline speech models write", () => {
  // Real outputs from Parakeet, Moonshine and Whisper on a test sermon
  assert.deepEqual(refs("Turn with me to Philippians chapter 4, verse 6."), ["Philippians 4:6"]);
  assert.deepEqual(refs("Let me take you to Romans 8, 28."), ["Romans 8:28"]);
  assert.deepEqual(refs("Open your Bibles to 1 Corinthians 13, verse 4."), ["1 Corinthians 13:4"]);
  assert.deepEqual(refs("Ephesians 6.10, be strong in the Lord"), ["Ephesians 6:10"]);
  assert.deepEqual(refs("2 Timothy 1.7, God has not given us"), ["2 Timothy 1:7"]);
  assert.deepEqual(refs("Psalm 121, verse 1, I will lift up mine eyes"), ["Psalm 121:1"]);
  assert.deepEqual(refs("Ephesians 6 10 Be strong in the Lord"), ["Ephesians 6:10"]);
  assert.deepEqual(refs("Open your Bibles to 1st Corinthians 13, 1st 4."), ["1 Corinthians 13"]);
  assert.deepEqual(refs("it costs 3.50 in John's shop"), []);
});
