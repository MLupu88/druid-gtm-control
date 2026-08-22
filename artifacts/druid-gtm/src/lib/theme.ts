import { useState, useEffect } from "react";

// LS8 — light is the default production theme (restored from the LS2
// dark-lock); dark remains available as a user-selectable alternative.
// The pre-paint inline script in index.html applies the same default
// synchronously so there is no flash of the wrong theme on load.
type Theme = "light" | "dark";
const STORAGE_KEY = "druid-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof localStorage === "undefined") return "light";
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);

  return { theme, setTheme };
}
