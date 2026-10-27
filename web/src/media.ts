import { useEffect, useState } from "react";

/**
 * The compact (phone) layout: narrow windows, and phones in landscape (wider than 816px, but
 * short). The width cap keeps a touch tablet in landscape out of it when its keyboard opens and
 * the window gets short. `styles.css` repeats this query in its `@media` rules.
 */
export const COMPACT = "(max-width: 816px), (pointer: coarse) and (max-height: 520px) and (max-width: 1000px)";

/** A touch screen: opening a popover leaves focus (and the on-screen keyboard) in the editor. */
export const TOUCH = "(pointer: coarse)";

export const matches = (query: string) => window.matchMedia(query).matches;

/** Whether the compact layout applies, following changes (rotation, resizing). */
export function useCompact(): boolean {
  const [compact, setCompact] = useState(() => matches(COMPACT));
  useEffect(() => {
    const query = window.matchMedia(COMPACT);
    const onChange = () => setCompact(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return compact;
}

/**
 * Where the on-screen keyboard is, as CSS variables on <html>, for the bars fixed to the top and
 * bottom of the compact layout. Android (with `interactive-widget=resizes-content`) shrinks the
 * layout viewport itself, so the inset there is 0; iOS keeps the layout viewport and covers its
 * bottom with the keyboard, and may pan the visible area down.
 */
export function useViewportInsets() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return; // the CSS falls back to 0px / 100dvh
    const root = document.documentElement.style;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Pinch-zoomed: leave the bars where they are rather than chase the zoomed view.
      const zoomed = Math.abs(viewport.scale - 1) > 0.01;
      const top = zoomed ? 0 : viewport.offsetTop;
      const height = zoomed ? window.innerHeight : viewport.height;
      const covered = window.innerHeight - (viewport.offsetTop + viewport.height);
      // A keyboard is tall; a few pixels (a scrollbar, a browser bar settling) aren't one.
      const inset = zoomed || covered < 80 ? 0 : covered;
      root.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
      root.setProperty("--viewport-top", `${Math.round(top)}px`);
      root.setProperty("--viewport-height", `${Math.round(height)}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
}
