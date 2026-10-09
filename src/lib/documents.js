/* Documents read for their words: a PDF's text, page by page, and a Word
 * file's paragraphs. What a model is sent is that text, as for a text file
 * (lib/attach.js) -- every model can take it, and none of the servers blvrd
 * talks to takes a PDF or a .docx itself.
 *
 * PDFs are read with pdf.js, loaded the first time one is attached. A .docx
 * is a zip of XML: its body (word/document.xml) is unpacked here with the
 * browser's own inflate, and the text taken from its runs. */

/** A document's text: { text } or { error } -- the error a few words saying
 *  why, to follow the file's name. Stops once `limit` characters are read. */
export async function documentText(file, limit) {
  const name = file.name.toLowerCase();
  try {
    if (file.type === "application/pdf" || name.endsWith(".pdf")) return await pdfText(file, limit);
    return await docxText(await file.arrayBuffer(), limit);
  } catch (problem) {
    if (problem?.name === "PasswordException") return { error: "is locked with a password" };
    console.warn(`Reading ${file.name}:`, problem);
    return { error: "couldn't be read" };
  }
}

const NO_TEXT = "has no text to read (it may be a scan). Attach its pages as pictures instead";

async function pdfText(file, limit) {
  const pdfjs = await import("pdfjs-dist");
  const { default: worker } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  try {
    const pdf = await loading.promise;
    const pages = [];
    let length = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      const text = items.map((item) => (item.str || "") + (item.hasEOL ? "\n" : "")).join("").trim();
      page.cleanup();
      if (text) pages.push(`[Page ${n}]\n${text}`);
      length += text.length;
      if (length > limit && n < pdf.numPages) {
        pages.push(`[...stopped after page ${n} of ${pdf.numPages}]`);
        break;
      }
    }
    return pages.length ? { text: pages.join("\n\n") } : { error: NO_TEXT };
  } finally {
    loading.destroy();
  }
}

/** A .docx's paragraphs, from the zip it is. Exported for the tests. */
export async function docxText(buffer, limit = Infinity) {
  const xml = await unzipEntry(buffer, "word/document.xml");
  if (xml == null) return { error: "isn't a Word document" };
  const text = wordText(xml).slice(0, limit).trim();
  return text ? { text } : { error: "has no text in it" };
}

/* The text of Word's XML: each run's words (<w:t>), tabs and line breaks, a
 * new line at the end of each paragraph. */
function wordText(xml) {
  let out = "";
  for (const [tag, words] of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>|<\/w:p>/g)) {
    if (words !== undefined) out += unescapeXml(words);
    else if (tag === "<w:tab/>") out += "\t";
    else out += "\n";
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? whole,
  );

/* One file out of a zip, as text, or null when it isn't there. Reads the
 * central directory at the end, then that file's own header for where its
 * data starts; stored and deflated entries, which is all Office writes. */
async function unzipEntry(buffer, wanted) {
  const view = new DataView(buffer);
  let end = -1;
  for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < count && view.getUint32(at, true) === 0x02014b50; i++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLength));
    if (name === wanted) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = new Uint8Array(buffer, start, size);
      if (method === 0) return decoder.decode(data);
      if (method !== 8) return null;
      const inflated = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(inflated).text();
    }
    at += 46 + skip;
  }
  return null;
}
