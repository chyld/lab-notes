import type { MouseEvent } from "react";
import { isMacOS } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";

// Tiptap's own check, so labels match how "Mod" is actually bound.
const IS_MAC = isMacOS();

/** "Mod+Shift+S" → "Ctrl+Shift+S", or "⌘⇧S" on macOS. */
function shortcutLabel(keys: string): string {
  if (!IS_MAC) return keys.replace("Mod", "Ctrl");
  const symbols: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥" };
  return keys
    .split("+")
    .map((key) => symbols[key] ?? key)
    .join("");
}

/** The aria-keyshortcuts form, e.g. "Control+Shift+S" or "Meta+B". */
function ariaShortcut(keys: string): string {
  return keys.replace("Mod", IS_MAC ? "Meta" : "Control");
}

// Keep focus (and the selection) in the editor when a toolbar button is clicked.
const keepEditorFocus = (event: MouseEvent) => event.preventDefault();

type ToolProps = {
  icon: LucideIcon;
  label: string;
  /** StarterKit's own shortcut, shown in the tooltip; "Mod" becomes Ctrl or ⌘, "Alt" ⌥ on Mac. */
  keys?: string;
  /** `fromKeyboard` is true for Enter/Space activation (no pointer), which keeps focus here. */
  onClick: (fromKeyboard: boolean) => void;
  active?: boolean;
  disabled?: boolean;
  /** Extra class for styling one button (e.g. the Save icon). */
  className?: string;
  /** A tooltip other than the label (the label stays the accessible name). */
  title?: string;
};

export function Tool({ icon: Icon, label, keys, onClick, active, disabled, className, title }: ToolProps) {
  return (
    <button
      type="button"
      className={className ? `tool ${className}` : "tool"}
      aria-label={label}
      title={title ?? (keys ? `${label} (${shortcutLabel(keys)})` : label)}
      aria-keyshortcuts={keys ? ariaShortcut(keys) : undefined}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keepEditorFocus}
      onClick={(event) => onClick(event.detail === 0)}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}

export function Divider() {
  return <div className="tool-divider" role="separator" aria-orientation="vertical" />;
}

