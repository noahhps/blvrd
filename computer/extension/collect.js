/* Run in a page: what's on it -- the things to act on, each given a number
 * (a ref, kept on the element while the page lives), any dialog, the main
 * text, where it's scrolled to. One function, run by Playwright in a browser
 * the computer started (computer/view.mjs) and by the blvrd extension in the
 * reader's own (background.js). It must stay self-contained: it is sent into
 * the page as it is. */

export const COLLECT = () => {
  const W = window;
  W.__blvrdN ||= 0;
  const SEL =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=option], [role=combobox], [role=textbox], [role=searchbox], [contenteditable=""], [contenteditable=true]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const squash = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const nameOf = (el) => {
    const by = (el.getAttribute("aria-labelledby") || "").split(" ").map((id) => document.getElementById(id)?.innerText || "").join(" ");
    const button = ["submit", "button", "reset"].includes(el.type) ? el.value : "";
    return squash(el.getAttribute("aria-label") || by || el.labels?.[0]?.innerText || el.innerText || button || el.placeholder || el.title || el.alt || el.querySelector?.("img[alt]")?.alt || el.getAttribute("name") || "").slice(0, 80);
  };
  const roleOf = (el) => {
    const r = el.getAttribute("role");
    if (r) return r;
    if (el.tagName === "A") return "link";
    if (el.tagName === "BUTTON" || el.tagName === "SUMMARY") return "button";
    if (el.tagName === "SELECT") return "select";
    if (el.tagName === "TEXTAREA" || el.isContentEditable) return "textbox";
    if (el.tagName === "INPUT") return { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", search: "searchbox", range: "slider", file: "file" }[el.type] || "textbox";
    return "button";
  };
  const items = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    if (!el.dataset.blvrdRef) el.dataset.blvrdRef = String(++W.__blvrdN);
    const role = roleOf(el);
    const state = [];
    if (el.disabled || el.getAttribute("aria-disabled") === "true") state.push("disabled");
    if (el.checked || el.getAttribute("aria-checked") === "true") state.push("✓");
    if (el.getAttribute("aria-expanded") === "true") state.push("open");
    if (el.getAttribute("aria-selected") === "true") state.push("selected");
    const value = el.tagName === "SELECT" ? el.options[el.selectedIndex]?.text : ["textbox", "searchbox", "combobox"].includes(role) ? (el.isContentEditable ? el.innerText : el.value) : "";
    if (value) state.push(el.type === "password" ? "= ••••" : `= "${squash(value).slice(0, 40)}"`);
    items.push({
      ref: el.dataset.blvrdRef,
      role,
      name: nameOf(el),
      state: state.join(" "),
      chrome: Boolean(el.closest("nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [role=menu]")),
      dialog: Boolean(el.closest("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]")),
    });
  }
  const dialogs = [...document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]")].filter(visible).map((d) => squash(d.innerText).slice(0, 500));
  const main = document.querySelector("main, [role=main], article") || document.body;
  const text = String(main?.innerText || "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const doc = document.documentElement;
  return { title: document.title, url: location.href, items, dialogs, text, scroll: { y: Math.round(scrollY), h: Math.round(doc.scrollHeight), vh: innerHeight } };
};

