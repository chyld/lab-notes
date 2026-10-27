import { useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { normalizeTag, tagHue } from "./tags.ts";

type Props = {
  tags: string[];
  /** What's typed in the input. Owned by the editor, so Save can commit it. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** Adds a tag if it's allowed (non-empty, new, under the limit). */
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
};

/** The note's tags as removable chips, plus an input that adds one on Enter, Space, comma, or blur. */
export function TagEditor({ tags, draft, onDraftChange, onAdd, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    onAdd(draft);
    onDraftChange("");
  }

  function onChange(raw: string) {
    // A space or comma ends a tag. Checked here, not only on keydown: phone keyboards often don't
    // report the key, and a paste like "home lab" is two tags.
    const parts = raw.split(/[\s,]+/);
    const last = parts.pop() ?? "";
    for (const part of parts) onAdd(normalizeTag(part));
    // Only a-z and 0-9 get in: uppercase is lowercased, anything else is dropped.
    onDraftChange(normalizeTag(last));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === " " || event.key === ",") {
      event.preventDefault();
      commit();
    }
  }

  return (
    <div className="tag-row" role="group" aria-label="Tags">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip" data-hue={tagHue(tag)}>
          #{tag}
          <button
            type="button"
            className="tag-remove"
            aria-label={`Remove tag ${tag}`}
            title={`Remove tag ${tag}`}
            onClick={() => {
              onRemove(tag);
              inputRef.current?.focus(); // the button is gone; keep focus in the row
            }}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="tag-input"
        aria-label="Add tag"
        placeholder="add tag"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  );
}
