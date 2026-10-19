'use client';

import { Button, Card } from '@heroui/react';
import { RotateCcw } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Route error boundary for the dashboard: a render/runtime error in one view
 * shows a recoverable card instead of Next.js's blank error screen. The shell
 * (sidebar, header) stays mounted because this replaces the page segment only.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-64 items-center justify-center">
      <Card className="max-w-xl">
        <Card.Header>
          <Card.Title>Something went wrong on this screen</Card.Title>
          <Card.Description>
            {error.message || 'Unexpected error — retry, or reload the page if it keeps failing.'}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Button variant="secondary" size="sm" onPress={reset}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </Button>
        </Card.Content>
      </Card>
    </div>
  );
}
