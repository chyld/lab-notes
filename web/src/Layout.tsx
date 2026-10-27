import { useCallback, useMemo, useState } from "react";
import { Outlet, useParams } from "react-router";
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
      <main className="status">
        <p className="muted">Pick a note, or create a new one.</p>
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
