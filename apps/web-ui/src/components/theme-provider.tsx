"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { themeVariables } from "@nexu-design/tokens";

export type AppTheme = "system" | "light" | "dark";

type ResolvedTheme = Exclude<AppTheme, "system">;

type ThemeContextValue = {
  readonly theme: AppTheme;
  readonly resolvedTheme: ResolvedTheme;
  readonly setTheme: (theme: AppTheme) => void;
};

const THEME_STORAGE_KEY = "monet.theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveTheme(theme: AppTheme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  const variables = themeVariables[theme] as Record<string, string>;

  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;

  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(key, value);
  }
}

function getStoredTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "system";
  }

  const value = window.localStorage.getItem(THEME_STORAGE_KEY);

  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getStoredTheme()));

  useEffect(() => {
    const nextResolvedTheme = resolveTheme(theme);
    setResolvedTheme(nextResolvedTheme);
    applyTheme(nextResolvedTheme);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    if (theme !== "system" || typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleChange = () => {
      const systemTheme = getSystemTheme();
      setResolvedTheme(systemTheme);
      applyTheme(systemTheme);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme(nextTheme) {
        setThemeState(nextTheme);
      }
    }),
    [resolvedTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }

  return context;
}
