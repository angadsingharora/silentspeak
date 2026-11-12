import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { model } from "./model";
import "./styles.css";

model.start();
// Debug handle: poke at the live app from the console (`silentspeak.dataset`, `silentspeak.capture`, …).
(window as unknown as { silentspeak: typeof model }).silentspeak = model;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
