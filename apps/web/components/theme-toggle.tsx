'use client';

import { Button } from '@heroui/react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

/**
 * Both icons render and CSS picks one, so the server HTML matches the client
 * (no mounted-state flicker); `resolvedTheme` is only read in the press handler.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      isIconOnly
      variant="ghost"
      aria-label="Toggle color theme"
      onPress={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="hidden size-4 dark:block" aria-hidden />
      <Moon className="size-4 dark:hidden" aria-hidden />
    </Button>
  );
}
