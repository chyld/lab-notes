import { useLayoutEffect, useRef, type Ref } from "react";

type Props = {
  text: string;
  onChange: (text: string) => void;
  /** The note can't be shown as Markdown exactly: say so above the text. */
  lossy: boolean;
  /** The text couldn't be read back into a note. */
  error: string | null;
  textareaRef: Ref<HTMLTextAreaElement>;
};

/**
 * The Markdown source view: the note as text in a box that grows with it, so the page scrolls as
 * it does with the editor (see SPEC "Markdown source").
 */
export function MarkdownSource({ text, onChange, lossy, error, textareaRef }: Props) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null);

  // Its height follows its text (measured once it's shown: a hidden element measures 0), and the
  // window's width (which rewraps it).
  useLayoutEffect(() => {
    const el = ownRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);

  // Focus, caret at the start, when it opens.
  useLayoutEffect(() => {
    const el = ownRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(0, 0);
  }, []);

  return (
    <div className="markdown-source">
      {lossy && (
        <p className="markdown-note muted">
          Some of this note's formatting can't be shown as Markdown; editing here may change it.
        </p>
      )}
      <textarea
        ref={(el) => {
          ownRef.current = el;
          if (typeof textareaRef === "function") textareaRef(el);
          else if (textareaRef) textareaRef.current = el;
        }}
        className="markdown-text"
        aria-label="Markdown source"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p className="markdown-note error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
