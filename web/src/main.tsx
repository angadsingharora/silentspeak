import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { model } from "./model";
import "./styles.css";

model.start();
(window as unknown as { silentspeak: typeof model }).silentspeak = model;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
