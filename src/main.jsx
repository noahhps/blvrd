import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import { Quick } from "./components/Quick.jsx";
import "./styles/app.css";
import "./styles/orbit.css";

// The same page is two windows: the app, and the quickview (lib/quick.js).
const quick = location.hash === "#quick";
if (quick) document.documentElement.dataset.window = "quick";

const root = createRoot(document.getElementById("root"));

if (import.meta.env.DEV && !quick) {
  // Under the dev server: a switch between your data and stress-test
  // fixtures (src/dev). Left out of the built app entirely.
  import("./dev/DevRoot.jsx").then(({ DevRoot }) =>
    root.render(
      <React.StrictMode>
        <DevRoot App={App} />
      </React.StrictMode>,
    ),
  );
} else {
  root.render(
    <React.StrictMode>
      {quick ? <Quick /> : <App />}
    </React.StrictMode>,
  );
}
