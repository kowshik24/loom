import React from "react";
import { createRoot } from "react-dom/client";
import { LibraryApp } from "./LibraryApp";
import "./library.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LibraryApp />
  </React.StrictMode>
);
