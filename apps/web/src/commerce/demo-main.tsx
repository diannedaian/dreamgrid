import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CommerceDemo } from "./CommerceDemo";
import "../styles/global.css";

// Dev-only entry served at /commerce-demo.html; it is not part of the app build.
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Commerce demo could not find the #root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <CommerceDemo />
  </StrictMode>,
);
