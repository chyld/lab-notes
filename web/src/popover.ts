import { useEffect, useState, type FocusEvent, type RefObject } from "react";

/**
 * Where a toolbar popover goes: under its button, kept inside the window. Measured once, on open;
 * the popover is `position: fixed` in a portal (the toolbar scrolls sideways, which would clip it).
 */
export function usePopoverPosition(anchor: HTMLElement, width: number) {
  const [position] = useState(() => {
    const rect = anchor.getBoundingClientRect();
    return { top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) };
  });
  return position;
}

/**
 * Close on a click outside (the button toggles itself), a resize, or an element scrolling outside
 * the popover (the toolbar scrolling sideways would leave the fixed popover behind). Page scrolls
 * are fine: the header is sticky, so the button doesn't move. Returns the popover's onBlur, which
 * closes it when keyboard focus leaves (e.g. Tab past its last control).
 */
export function useDismiss(popoverRef: RefObject<HTMLElement | null>, anchor: HTMLElement, onClose: () => void) {
  useEffect(() => {
    const outside = (target: EventTarget | null) =>
      !popoverRef.current?.contains(target as Node) && !anchor.contains(target as Node);
    const onPointerDown = (event: PointerEvent) => outside(event.target) && onClose();
    const onScroll = (event: Event) => event.target !== document && outside(event.target) && onClose();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [popoverRef, anchor, onClose]);

  return (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (!popoverRef.current?.contains(next) && !anchor.contains(next)) onClose();
  };
}
