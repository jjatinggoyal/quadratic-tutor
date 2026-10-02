import "katex/dist/katex.min.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { InsightsPage } from "./Insights";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname.startsWith("/insights") ? <InsightsPage /> : <App />}
  </StrictMode>,
);
