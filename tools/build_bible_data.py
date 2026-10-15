"""Build data/bible.json from scrollmapper/bible_databases JSON exports.

Usage:
  git clone --depth 1 https://github.com/scrollmapper/bible_databases
  python3 tools/build_bible_data.py path/to/bible_databases/formats/json

Output: data/bible.json with a shared verse index and three translations:
  kjv  - displayed on screen (public domain)
  bsb  - Berean Standard Bible, used only to match modern wording (public domain)
  nheb - New Heart English Bible, used only to match modern wording (public domain)
"""
import json, re, sys, os

BOOKS = ["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
"1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah",
"Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah",
"Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum",
"Habakkuk","Zephaniah","Haggai","Zechariah","Malachi","Matthew","Mark","Luke","John","Acts",
"Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians",
"1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews",
"James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"]

def clean(t):
    t = t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = re.sub(r"\s+", " ", t).strip()
    return t

def load(path):
    d = json.load(open(path, encoding="utf-8"))
    assert len(d["books"]) == 66, path
    out = {}
    for bi, b in enumerate(d["books"]):
        for c in b["chapters"]:
            for v in c["verses"]:
                out[(bi, c["chapter"], v["verse"])] = clean(v["text"])
    return out

def main(src):
    kjv = load(os.path.join(src, "KJV.json"))
    bsb = load(os.path.join(src, "BSB.json"))
    nheb = load(os.path.join(src, "NHEB.json"))
    keys = sorted(kjv.keys())
    chapters = [[] for _ in BOOKS]
    for (b, c, v) in keys:
        while len(chapters[b]) < c:
            chapters[b].append(0)
        chapters[b][c - 1] = max(chapters[b][c - 1], v)
    # KJV versification is the master index; other translations are aligned to it.
    data = {
        "books": [{"name": n, "chapters": chapters[i]} for i, n in enumerate(BOOKS)],
        "kjv": [kjv[k] for k in keys],
        "bsb": [bsb.get(k, "") for k in keys],
        "nheb": [nheb.get(k, "") for k in keys],
        "sources": {
            "kjv": "King James Version (1769), public domain",
            "bsb": "Berean Standard Bible, public domain (CC0)",
            "nheb": "New Heart English Bible, public domain",
        },
    }
    # sanity: every key must exist in the chapter grid without gaps
    total = sum(sum(c) for c in chapters)
    assert total == len(keys), (total, len(keys))
    out = os.path.join(os.path.dirname(__file__), "..", "data", "bible.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("verses", len(keys), "missing bsb", sum(1 for x in data["bsb"] if not x),
          "missing nheb", sum(1 for x in data["nheb"] if not x), "bytes", os.path.getsize(out))

if __name__ == "__main__":
    main(sys.argv[1])
