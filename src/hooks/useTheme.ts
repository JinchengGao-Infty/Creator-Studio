import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "creatorai:theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  return { theme, setTheme, toggle };
}

