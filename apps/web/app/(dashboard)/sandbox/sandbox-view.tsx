'use client';

import { PageHeader } from '@/components/ui/page-header';

import { PlaygroundView } from '../playground/playground-view';

export function SandboxView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Agent workspace"
        title="Sandbox chat"
        description="Ask the agent questions using only the document knowledge bases you select. Replies are for testing and are never sent to customers."
      />
      <PlaygroundView />
    </div>
  );
}
