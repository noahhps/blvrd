import { useCallback, useEffect, useRef, useState } from "react";

import { kindOf, prepare } from "../lib/attach.js";
import { Icon } from "./Icon.jsx";

/* Files waiting to go with a message (lib/attach.js), for a message box:
 * picked with the paperclip, or dropped anywhere on the window -- `dropping`
 * is true while files are held over it, so the box can light up. A file that
 * can't be sent is still shown, with why, until it is removed. Used by the
 * composer and the quickview. */
export function useAttachments() {
  const [staged, setStaged] = useState([]); // { key, file, preview, problem }
  const [dropping, setDropping] = useState(false);
  const picker = useRef(null);
  const depth = useRef(0);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  const stage = useCallback((files) => {
    const items = [...files].map((file) => {
      const kind = kindOf(file);
      return {
        key: `${file.name}:${file.size}:${file.lastModified}:${Math.random()}`,
        file,
        preview: kind === "image" ? URL.createObjectURL(file) : null,
        problem: kind ? null : "isn't a picture or a text file",
      };
    });
    setStaged((prev) => [...prev, ...items]);
  }, []);

  const unstage = (key) =>
    setStaged((prev) => {
      const going = prev.find((i) => i.key === key);
      if (going?.preview) URL.revokeObjectURL(going.preview);
      return prev.filter((i) => i.key !== key);
    });

  // Dropping anywhere on the window. Depth-counted, because dragenter and
  // dragleave fire for every element crossed on the way in.
  useEffect(() => {
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    const enter = (e) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDropping(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDropping(false);
    };
    const over = (e) => hasFiles(e) && e.preventDefault();
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDropping(false);
      stage(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [stage]);

  useEffect(() => () => stagedRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const usable = staged.filter((i) => !i.problem);

  return {
    staged,
    usable,
    dropping,
    stage,
    /** The files that can go, read and made ready; the box is emptied. */
    take: async () => {
      const going = usable;
      setStaged([]);
      const files = (await Promise.all(going.map((i) => prepare(i.file)))).filter((f) => !f.error);
      going.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
      return files;
    },
    /** The hidden file input and the paperclip that opens it. */
    button: (
      <>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            stage(e.target.files);
            e.target.value = ""; // so picking the same file again still fires
          }}
        />
        <button type="button" className="chip icon" aria-label="Attach files" title="Attach pictures or text files" onClick={() => picker.current.click()}>
          <Icon name="paperclip" size={16} />
        </button>
      </>
    ),
    list: staged.length ? (
      <ul className="staged" aria-label="Attached">
        {staged.map((item) => (
          <li key={item.key} className="staged-item" data-problem={item.problem ? "" : undefined} title={item.problem ? `${item.file.name} ${item.problem}` : item.file.name}>
            {item.preview ? <img src={item.preview} alt="" /> : <Icon name={item.problem ? "close" : "file"} size={16} />}
            <span className="staged-name">{item.file.name}</span>
            <button type="button" aria-label={`Remove ${item.file.name}`} onClick={() => unstage(item.key)}>
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
      </ul>
    ) : null,
  };
}
