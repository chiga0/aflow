import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (!root) {
  document.body.innerHTML = '<pre style="color:red;padding:20px">Missing #root element</pre>';
} else {
  try {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (err) {
    root.innerHTML = `<pre style="color:red;padding:20px;white-space:pre-wrap">${String(err)}\n${(err as Error).stack ?? ""}</pre>`;
  }
}
