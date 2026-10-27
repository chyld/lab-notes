import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { NotesList } from "./NotesList.tsx";
import { NotePage } from "./NotePage.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NotesList />} />
        <Route path="/notes/:id" element={<NotePage />} />
        <Route
          path="*"
          element={
            <main className="list-page">
              <p className="muted">Page not found.</p>
              <Link to="/">← Lab Notes</Link>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
