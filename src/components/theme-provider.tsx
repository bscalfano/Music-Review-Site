"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

/** Light/dark mode: follows the system by default; the header toggle overrides it. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
