import { useEffect, useState, type CSSProperties, type FocusEvent, type MouseEvent, type RefObject } from "react";
import { COMPACT, matches, TOUCH } from "./media.ts";

type Placement = {
  /** Compact layout: a sheet above the bottom toolbar, laid out by CSS (`.popover-sheet`). */
  sheet: boolean;
  /** Wide layout: under the button, kept inside the window. */
  style: CSSProperties | undefined;
  /** On a touch screen, opening doesn't move focus: the editor (and its keyboard) keep it. */
  touch: boolean;
};

/**
 * Where a toolbar popover goes. Measured once, on open; the popover is `position: fixed` in a
 * portal (the toolbar scrolls sideways, which would clip it).
 */
export function usePopoverPlacement(anchor: HTMLElement, width: number): Placement {
  const [placement] = useState(() => {
    const touch = matches(TOUCH);
    if (matches(COMPACT)) return { sheet: true, style: undefined, touch };
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    return { sheet: false, style: { top: rect.bottom + 4, left, width }, touch };
  });
  return placement;
}

/**
 * Close on a click outside (the button toggles itself), the window's width changing, or (when
 * anchored under its button) an element scrolling outside the popover: the toolbar scrolling
 * sideways would leave the fixed popover behind. Page scrolls are fine: the header is sticky, so
 * the button doesn't move. A height change alone (an on-screen keyboard opening or closing)
 * closes an anchored popover only if it no longer fits, and never a sheet. Returns the popover's
 * onBlur, which closes it when keyboard focus moves somewhere outside (e.g. Tab past its last
 * control); focus going nowhere (iOS's keyboard "Done") doesn't.
 */
/**
 * A tap on a popover's or the toolbar's background (padding, gaps, dividers) keeps focus where it
 * is: on iOS it would otherwise blur the editor and close the keyboard. Fields still take focus.
 */
export function keepFocus(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.closest("input, select, textarea")) {
    event.preventDefault();
  }
}

export function useDismiss(
  popoverRef: RefObject<HTMLElement | null>,
  anchor: HTMLElement,
  onClose: () => void,
  sheet = false,
) {
  useEffect(() => {
    const outside = (target: EventTarget | null) =>
      !popoverRef.current?.contains(target as Node) && !anchor.contains(target as Node);
    const onPointerDown = (event: PointerEvent) => outside(event.target) && onClose();
    const onScroll = (event: Event) => event.target !== document && outside(event.target) && onClose();
    let width = window.innerWidth;
    const onResize = () => {
      const offScreen = !sheet && (popoverRef.current?.getBoundingClientRect().bottom ?? 0) > window.innerHeight;
      if (window.innerWidth !== width || offScreen) onClose();
      width = window.innerWidth;
    };
    window.addEventListener("pointerdown", onPointerDown);
    if (!sheet) window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [popoverRef, anchor, onClose, sheet]);

  return (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && !popoverRef.current?.contains(next) && !anchor.contains(next)) onClose();
  };
}
