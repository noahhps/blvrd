import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import { Quick } from "./components/Quick.jsx";
import "./styles/app.css";
import "./styles/orbit.css";

// The same page is two windows: the app, and the quickview (lib/quick.js).
const quick = location.hash === "#quick";
if (quick) document.documentElement.dataset.window = "quick";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {quick ? <Quick /> : <App />}
  </React.StrictMode>,
);
