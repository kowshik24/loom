import React from "react";
import { createRoot } from "react-dom/client";
import { RecorderApp } from "./RecorderApp";
import "./recorder.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RecorderApp />
  </React.StrictMode>
);
