/* The sidebar's widget order (components/widgets): what was saved, squared
 * with what there is to show. */

// The saved order of what's in `catalog`, with any widget it doesn't know of
// yet put in after the one it follows in the catalog (a new widget lands
// where it would by default).
export const orderOf = (ids = [], catalog = []) => {
  const known = new Set(catalog.map((w) => w.id));
  const out = ids.filter((id, i) => known.has(id) && ids.indexOf(id) === i);
  catalog.forEach(({ id }, i) => {
    if (out.includes(id)) return;
    const before = catalog.slice(0, i).reverse().find((w) => out.includes(w.id));
    out.splice(before ? out.indexOf(before.id) + 1 : 0, 0, id);
  });
  return out;
};

/** `next` (the widgets shown, in their new order) with everything in `saved`
 *  that isn't shown kept in its old slot among them -- so reordering the
 *  sidebar reorders the notebook without moving its other sections. */
export function keepHidden(saved, next) {
  const queue = [...next];
  const out = [];
  for (const id of saved) out.push(next.includes(id) ? queue.shift() : id);
  return [...out, ...queue];
}
