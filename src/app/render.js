// Shared helpers for showing KJV text.

export function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/** KJV marks words added by the translators in [brackets]; traditionally printed in italics. */
export function verseHtml(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]/g, "<em>$1</em>")
    .replace(/^A Psalm of David\.\s*/i, (m) => `<span class="superscription">${m.trim()}</span> `);
}
