// Shared text normalisation for matching spoken words against verse text.
// KJV, modern translations and speech-to-text all pass through the same steps,
// so "believeth", "believes" and "believed" end up as the same word.

const ARCHAIC = {
  thee: "you", thou: "you", ye: "you", thy: "your", thine: "your", yourselves: "yourself",
  hath: "has", hast: "have", doth: "does", dost: "do", saith: "says", spake: "spoke",
  shalt: "shall", wilt: "will", canst: "can", didst: "did", art: "are", wast: "was", wert: "were",
  unto: "to", whosoever: "whoever", whatsoever: "whatever", whomsoever: "whoever", wherefore: "therefore",
  thereof: "of it", hither: "here", thither: "there", ere: "before", lo: "behold", nay: "no", yea: "yes",
  shew: "show", shewed: "showed", sheweth: "shows", begotten: "begotten",
};

// Words people swap freely when paraphrasing. Each maps to one shared form.
const SYNONYMS = {
  worry: "anxious", worried: "anxious", worrying: "anxious", anxiety: "anxious", anxieties: "anxious",
  everlasting: "eternal", forever: "eternal",
  everyone: "whoever", anyone: "whoever",
  afraid: "fear", fearful: "fear", scared: "fear", frightened: "fear", terrified: "fear", dismayed: "fear",
  kids: "children", child: "children",
  dad: "father", mom: "mother", mum: "mother",
  want: "need", lack: "need", needs: "need",
  big: "great", large: "great",
  strengthens: "strength", strengtheneth: "strength", strengthen: "strength", strong: "strength",
  happy: "blessed",
  trouble: "tribulation", troubles: "tribulation", trials: "tribulation",
  compassion: "mercy", compassions: "mercy",
  sins: "sin", iniquities: "sin", iniquity: "sin", transgressions: "sin", trespasses: "sin",
  rewarder: "reward", rewards: "reward",
  plans: "thoughts", plan: "thoughts",
  welfare: "peace", future: "end",
  depend: "lean", rely: "lean",
  paths: "path", ways: "path", way: "path",
  straight: "direct",
  prayer: "pray", prayers: "pray", praying: "pray", prayed: "pray",
  anything: "nothing",
};

export const STOPWORDS = new Set((
  "a an the and or but if of to in on at by for with from into onto upon out over under up down off " +
  "is are was were be been being am do does did done have has had having shall will would should can could may might must " +
  "i me my mine myself you your yourself he him his himself she her hers herself it its itself we us our ours ourselves they them their theirs themselves " +
  "this that these those there here then than so as not no nor also too very just even all any every each some such " +
  "what which who whom whose when where why how whoever whatever therefore because said says say saying " +
  "o oh behold now again let one also yes come came go went say s t " +
  "about instead really actually somebody anybody everybody amen hallelujah alleluia okay ok please today tonight morning church people"
).split(" "));

/** Light suffix stripper. Not linguistic — it only needs to be consistent. */
export function stem(w) {
  if (w.length <= 3) return w;
  let s = w;
  if (s.endsWith("eth") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("est") && s.length > 6) s = s.slice(0, -3);
  else if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("edst") && s.length > 6) s = s.slice(0, -4);
  else if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("es") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) s = s.slice(0, -1);
  if (s.endsWith("e") && s.length > 3) s = s.slice(0, -1);
  if (s.length > 4 && s[s.length - 1] === s[s.length - 2]) s = s.slice(0, -1); // runn -> run
  return s;
}

/** Lowercase words with archaic forms and synonyms folded, before stemming. */
export function words(text) {
  const out = [];
  const raw = text.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/);
  for (let w of raw) {
    if (!w) continue;
    if (ARCHAIC[w]) {
      for (const p of ARCHAIC[w].split(" ")) out.push(SYNONYMS[p] || p);
      continue;
    }
    out.push(SYNONYMS[w] || w);
  }
  return out;
}

/** All stems in order (stopwords kept) — used for phrase shingles. */
export function phraseStems(text) {
  return words(text).map(stem);
}

/** Content stems in order (stopwords removed) — used for scoring. */
export function contentStems(text) {
  return words(text).filter((w) => !STOPWORDS.has(w)).map(stem);
}

/** 32-bit FNV-1a hash of a string. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
