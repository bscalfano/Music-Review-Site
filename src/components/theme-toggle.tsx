"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const ORDER = ["system", "light", "dark"] as const;
const ICONS = { system: Monitor, light: Sun, dark: Moon };
const subscribe = () => () => {};

export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme();
  // The real theme is only known on the client; avoid a hydration mismatch on the icon.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const current = (ORDER as readonly string[]).includes(theme)
    ? (theme as (typeof ORDER)[number])
    : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = mounted ? ICONS[current] : Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${current}. Switch to ${next}.`}
    >
      <Icon />
    </Button>
  );
}
