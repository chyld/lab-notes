import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout, NoNoteOpen, PageNotFound } from "./Layout.tsx";
import { NotePage } from "./NotePage.tsx";
import "@fontsource-variable/inter";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<NoNoteOpen />} />
          <Route path="notes/:id" element={<NotePage />} />
          <Route path="*" element={<PageNotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
