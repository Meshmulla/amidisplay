// Verse lookup over the flat arrays in data/bible.json.

export class Bible {
  constructor(data) {
    this.data = data;
    this.books = data.books;
    // offsets[b][c-1] = flat index of verse 1 in that chapter
    this.offsets = [];
    this.refOf = []; // flat index -> [book, chapter, verse]
    let i = 0;
    data.books.forEach((book, b) => {
      const chOff = [];
      book.chapters.forEach((count, ci) => {
        chOff.push(i);
        for (let v = 1; v <= count; v++) this.refOf.push([b, ci + 1, v]);
        i += count;
      });
      this.offsets.push(chOff);
    });
    this.size = i;
  }

  index(book, chapter, verse) {
    const c = this.offsets[book]?.[chapter - 1];
    if (c === undefined) return -1;
    if (verse < 1 || verse > this.books[book].chapters[chapter - 1]) return -1;
    return c + verse - 1;
  }

  text(i, version = "kjv") {
    return this.data[version][i] || "";
  }

  ref(i) {
    const [book, chapter, verse] = this.refOf[i];
    return { book, chapter, verse, endVerse: verse };
  }

  /** Next/previous verse, crossing chapter boundaries within a book. */
  step(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.size) return -1;
    if (this.refOf[j][0] !== this.refOf[i][0]) return -1;
    return j;
  }
}
