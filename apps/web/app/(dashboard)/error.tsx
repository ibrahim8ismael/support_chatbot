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
    <div className="flex min-h-[60vh] items-center justify-center py-8">
      <Card className="w-full max-w-xl">
        <Card.Header>
          <div className="mb-2 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-signature-coral" aria-hidden />
            <p className="text-[10px] font-medium tracking-[0.18em] text-muted uppercase">
              Unexpected error
            </p>
          </div>
          <h2 className="text-2xl font-normal tracking-[-0.02em]">This screen hit a snag.</h2>
          <Card.Description>
            {error.message || 'Unexpected error — retry, or reload the page if it keeps failing.'}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Button variant="secondary" onPress={reset}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </Button>
        </Card.Content>
      </Card>
    </div>
  );
}
