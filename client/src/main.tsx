import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toasty, TooltipProvider } from "@cloudflare/kumo";
import "./index.css";
import { App } from "./App";

// Follow the OS colour scheme. Kumo reads `data-mode` for its dark variants.
const media = window.matchMedia("(prefers-color-scheme: dark)");
const applyMode = () => {
  document.documentElement.dataset.mode = media.matches ? "dark" : "light";
};
applyMode();
media.addEventListener("change", applyMode);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Toasty>
        <App />
      </Toasty>
    </TooltipProvider>
  </StrictMode>,
);
