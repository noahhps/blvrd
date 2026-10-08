/* A widget's name, which is also how it is picked up and moved; anything it
   can do (`action`) sits at the other end. */
export function WidgetHead({ label, handle, action = null }) {
  return (
    <div className="widget-head">
      <button type="button" className="widget-grip" aria-roledescription="movable widget" title="Drag to move" {...handle}>
        <span className="label">{label}</span>
      </button>
      {action}
    </div>
  );
}
