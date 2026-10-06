/* Files a message carries.
 *
 * Pictures are shrunk to at most 1568px on the long side and stored as JPEG
 * data URLs -- small enough to keep in the chat's storage, large enough for a
 * model to read text in a screenshot. Text files (code, Markdown, CSV, JSON,
 * plain text) are read and put into the message as text, which every model can
 * take. Anything else is refused with a reason rather than sent as noise. */

const LONG_SIDE = 1568;
const TEXT_LIMIT = 200_000;
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-sh|x-yaml|toml|sql))/;
const TEXT_NAMES = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|cfg|conf|log|sql|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|fish|lua|r|jl|scala|dart|vue|svelte)$/i;

export function kindOf(file) {
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") return "image";
  if (TEXT_TYPES.test(file.type) || TEXT_NAMES.test(file.name)) return "text";
  return null;
}

async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // a transparent PNG would otherwise go black as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** A staged file made ready to send: { name, kind, dataUrl? , text? } or { error }. */
export async function prepare(file) {
  const kind = kindOf(file);
  if (kind === "image") {
    try {
      return { name: file.name, kind, dataUrl: await shrink(file) };
    } catch {
      return { name: file.name, error: "couldn't be read as a picture" };
    }
  }
  if (kind === "text") {
    const text = await file.text();
    return text.length > TEXT_LIMIT
      ? { name: file.name, kind, text: `${text.slice(0, TEXT_LIMIT)}\n[...cut at ${TEXT_LIMIT} characters]` }
      : { name: file.name, kind, text };
  }
  return { name: file.name, error: "isn't a picture or a text file" };
}

/** The text a model reads for a message: what was typed, then each text file. */
export function textWithFiles(content, files = []) {
  const parts = [content || ""];
  for (const f of files) {
    if (f.kind !== "text") continue;
    const fence = f.text.includes("```") ? "````" : "```";
    parts.push(`Attached file ${f.name}:\n${fence}\n${f.text}\n${fence}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

/** [media type, base64] from a data URL. */
export function splitDataUrl(url) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url || "");
  return m ? [m[1], m[2]] : [null, null];
}
