# FlashDisplay

FlashDisplay listens to the sermon, works out which Bible verse the preacher is reading, quoting or paraphrasing, and gets the **KJV** text ready to put on the projector with one key press.

It catches verses three ways:

- **Spoken references.** "John three sixteen", "Romans chapter 8 verse 28", "first Corinthians thirteen four", "Psalm 23", and follow-ups like "look at verse seven".
- **Quotes in any translation.** The preacher reads from the NIV, NLT or NKJV, and FlashDisplay still shows the KJV verse.
- **Paraphrase.** "Don't worry about anything, pray about everything" finds Philippians 4:6.

Nothing goes on screen until the media desk presses **Show** (or Enter), unless you turn on automatic showing in Settings.

## Running it on the media laptop

You need **Google Chrome** (or Microsoft Edge) and an internet connection. Chrome's speech recognition runs online.

**Option 1: hosted on GitHub Pages (easiest)**

1. In this repo on GitHub, go to **Settings → Pages**.
2. Under "Build and deployment", choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute, open `https://meshmulla.github.io/flashdisplay/` in Chrome.

**Option 2: run it from the laptop**

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. Download this repo and, in its folder, run `npm start`.
3. Open `http://localhost:5173` in Chrome.

Either way, allow the microphone when Chrome asks.

## During the service

1. Press **Open projector screen**. Drag the new window onto the projector and double-click it (or press F) to make it full screen.
2. Press **Start listening** when the preacher begins.
3. Verses appear under **Verses found**, newest at the top. The newest one is opened up so you can read it before it goes live.
4. Press **Enter** or **Show** to put it on screen. The red edge around the preview means the congregation can see it.

| Key | Does |
| --- | --- |
| ↑ / ↓ | Choose a verse in the list |
| Enter | Show the chosen verse |
| ← / → | Previous / next verse on screen |
| Esc | Clear the screen |
| / | Jump to "Find a verse" |

**Find a verse** takes references ("jn 3 16", "1 cor 13:4-7") or a few remembered words ("rivers of living water").

### Using it with EasyWorship

Two ways, depending on how your setup works:

- **Keep EasyWorship as the projector.** Use FlashDisplay as the spotter: press **Copy reference**, paste it into EasyWorship's scripture search, and go live from EasyWorship.
- **Let FlashDisplay drive the screen for scripture.** Put the FlashDisplay screen window on the projector output. The **Lower third** and **Green screen** looks are made for livestream overlays.

### Screen looks

Settings has five looks: Evening (default), Black, Daylight (for bright halls), Lower third, and Green screen. You can also change the text size and hide the "KJV" label.

## Helping it hear your preacher

Chrome's speech recognition can't be trained, so FlashDisplay works around its mistakes:

- **Backup guesses.** For every sentence Chrome gives up to four guesses. If the top guess missed a reference but a backup heard "Philippians 4:6", FlashDisplay still finds it.
- **Misheard book names.** "Philippines 4:13", "a fusions 6:10", "Isaiah's 53", "have a cook 2:3", "Filipians 4 6" and similar are repaired, but only when a chapter and verse follow. "I visited the Philippines" is left alone.
- **Accented numbers.** "John chapter tree verse sixteen", "Psalm twenty tree", "Hebrews 11 verse for" and "Romans 8 versus 28" all work.
- **Book-name boosting.** In Chrome versions that support it, recognition is nudged toward Bible book names.

The fastest way to improve it further is real sermons. After a service, press **Save session** above the transcript. It downloads a text file with everything Chrome heard (including its backup guesses), every verse found, and every verse the media desk had to look up by hand. Verses looked up by hand are the misses; share the file and they become fixes and test cases.

## Rehearse without a preacher

Press **Play sample sermon**. It plays a short sermon through the same pipeline as the microphone, including spoken references, modern-translation quotes and paraphrase.

## How the matching works

- `src/engine/references.js` reads references out of speech. It turns spoken numbers into digits, knows the ways people say each book ("first John", "Song of Songs", "Revelations"), checks every chapter and verse actually exists, and remembers the last reference so "verse 17" means the right chapter.
- `src/engine/matcher.js` compares what was said with every verse in **three translations at once**: KJV, plus two modern public-domain translations, the Berean Standard Bible and the New Heart English Bible. A modern quote or paraphrase matches the modern wording of a verse, and FlashDisplay shows that verse in KJV. It scores both shared words (weighted so "shepherd" counts more than "Lord") and word-for-word stretches, so short quotes like "I can do all things" still land.
- It all runs in the browser, in a background worker. No sermon audio or text is sent anywhere except to Chrome's speech service.

## Development

```
npm test        # reference parsing and verse matching tests
npm start       # local server on http://localhost:5173
```

`tests/fixtures.js` holds real-world quotes and ordinary sermon talk. Add to it whenever the matcher gets something wrong in a real service; it's the fastest way to make it better.

To rebuild `data/bible.json` from source:

```
git clone --depth 1 https://github.com/scrollmapper/bible_databases
python3 tools/build_bible_data.py bible_databases/formats/json
```

## What's next

- **A stronger listening engine.** Either Whisper running on the laptop (offline, prompted with Bible vocabulary) or a paid cloud service with keyword boosting, chosen by testing your preacher's real recordings.
- **Smarter paraphrase matching** using meaning-based search for loose retellings that share few words with any translation.
- **Splitting very long verses** across two screens.
- **Sermon notes**: export the transcript and every verse shown after the service.

## Credits

- Bible text: King James Version (public domain). Matching also uses the Berean Standard Bible (public domain) and New Heart English Bible (public domain), via [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).
- Fonts: Newsreader and Instrument Sans, SIL Open Font License 1.1.
