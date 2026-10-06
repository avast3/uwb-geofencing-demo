import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SupervisorPage from "./SupervisorPage";
import "./index.css";

// Two pages, no router dependency: Vite's dev server serves index.html for
// every path, so the pathname alone picks the page.
const isSupervisor = window.location.pathname.replace(/\/+$/, "") === "/supervisor";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isSupervisor ? <SupervisorPage /> : <App />}</StrictMode>
);
