import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createRoutesFromElements, Route } from "react-router";
import "@fontsource-variable/inter";
import { Auth } from "./Auth.tsx";
import { Layout, NoNoteOpen, PageNotFound } from "./Layout.tsx";
import { NotePage } from "./NotePage.tsx";
import "./styles.css";

// A data router (rather than <BrowserRouter>), so the editor can block leaving with unsaved
// changes (useBlocker).
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Layout />}>
      <Route index element={<NoNoteOpen />} />
      <Route path="notes/:id" element={<NotePage />} />
      <Route path="*" element={<PageNotFound />} />
    </Route>,
  ),
);

// Signed out: the sign-in page; signed in: the router (see Auth.tsx).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Auth router={router} />
  </StrictMode>,
);
