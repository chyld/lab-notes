import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useParams } from "react-router";
import { useViewportInsets } from "./media.ts";
import { Sidebar, SidebarProvider, useSidebarState } from "./Sidebar.tsx";
import { TopBar } from "./TopBar.tsx";

/**
 * Every screen: the notes sidebar beside the routed screen. One sidebar instance for the whole
 * app, so it never remounts when switching notes or going to "/".
 */
export function Layout() {
  const { id = null } = useParams();
  const sidebar = useSidebarState();
  // Bumped after every save so the sidebar refetches (new notes, titles, tags, order).
  const [listVersion, setListVersion] = useState(0);
  const notesChanged = useCallback(() => setListVersion((v) => v + 1), []);
  const value = useMemo(() => ({ ...sidebar, notesChanged }), [sidebar, notesChanged]);
  useViewportInsets();

  // On a phone, "/" has nothing to show but the notes, so arriving there opens the drawer. Only
  // arriving: rotating the phone on "/" leaves a closed drawer closed.
  const home = id === null;
  const { narrow, setOpen } = sidebar;
  const wasHome = useRef(false);
  useEffect(() => {
    const arrived = home && !wasHome.current;
    wasHome.current = home;
    if (arrived && narrow) setOpen(true);
  }, [home, narrow, setOpen]);

  return (
    <SidebarProvider value={value}>
      <div className="note-layout">
        <Sidebar currentId={id} refresh={listVersion} />
        {/* Behind the narrow overlay the page is inert: no tabbing into the editor under it. */}
        <div className="note-main" inert={sidebar.narrow && sidebar.open}>
          <Outlet />
        </div>
      </div>
    </SidebarProvider>
  );
}

/** "/": no note open. */
export function NoNoteOpen() {
  return (
    <>
      <TopBar />
      <main className="empty-state">
        <img src="/logo.svg" alt="" width={56} height={56} />
        <p>Pick a note, or create a new one.</p>
      </main>
    </>
  );
}

export function PageNotFound() {
  return (
    <>
      <TopBar />
      <main className="status">
        <p className="muted">Page not found.</p>
      </main>
    </>
  );
}
