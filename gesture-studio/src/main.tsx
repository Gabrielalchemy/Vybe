import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { createAppRuntime, type AppRuntime } from "./app/runtime";
import { Showcase } from "./features/dev/Showcase";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/app.css";

// Runtime objects live outside React so StrictMode/dev remounts cannot create
// duplicates. Hot reloads keep the same instance.
const hot = import.meta.hot;
const runtime: AppRuntime = (hot?.data.runtime as AppRuntime | undefined) ?? createAppRuntime();
if (hot) hot.data.runtime = runtime;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// Development-only component showcase at /?showcase (DESIGN_SYSTEM.md §8).
const showcase = import.meta.env.DEV && new URLSearchParams(location.search).has("showcase");

createRoot(root).render(<StrictMode>{showcase ? <Showcase /> : <App runtime={runtime} />}</StrictMode>);
