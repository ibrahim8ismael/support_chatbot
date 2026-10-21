import type { Metadata } from 'next';
import { Bot, CheckCircle2, FileText, ShieldCheck } from 'lucide-react';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(420px,44%)]">
      <section className="flex min-h-screen flex-col px-6 py-8 sm:px-10 lg:px-14 xl:px-20">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-9 items-center justify-center rounded-[10px] bg-foreground text-background shadow-sm">
            <Bot className="size-5" aria-hidden />
            <span
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full border-2 border-background bg-signature-coral"
              aria-hidden
            />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-medium tracking-[-0.01em]">Support Agent</span>
            <span className="mt-1 text-[10px] tracking-[0.12em] text-muted uppercase">
              Operations
            </span>
          </span>
        </div>

        <div className="flex flex-1 items-center py-12">
          <div className="w-full max-w-[420px]">
            <div className="mb-3 flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-signature-coral" aria-hidden />
              <p className="text-[10px] font-medium tracking-[0.18em] text-muted uppercase">
                Welcome back
              </p>
            </div>
            <h1 className="text-[38px] leading-[1.1] font-normal tracking-[-0.03em] text-foreground">
              Sign in to your workspace.
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted">
              Manage knowledge, conversations and bot behavior from one calm operations surface.
            </p>

            <div className="mt-8">
              <LoginForm />
            </div>

            <p className="mt-6 text-xs text-muted">Internal tool — authorized staff only.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-separator pt-4 text-[11px] text-muted">
          <span>© {new Date().getFullYear()} Support Agent</span>
          <span>Grounded answers, human oversight</span>
        </div>
      </section>

      <aside className="relative hidden overflow-hidden bg-signature-forest p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="flex items-center gap-2 text-[10px] font-medium tracking-[0.18em] text-white/60 uppercase">
          <span className="size-1.5 rounded-full bg-signature-peach" aria-hidden />
          Knowledge-grounded support
        </div>

        <div className="my-auto max-w-[520px] py-12">
          <h2 className="text-[40px] leading-[1.08] font-normal tracking-[-0.03em] text-white">
            Answers that stay grounded in your own knowledge.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-6 text-white/70">
            Upload documents, bind inboxes and watch deflection in one workspace. Every answer is
            traceable to the chunks behind it.
          </p>

          <div className="mt-10 grid gap-3">
            <div className="rounded-xl bg-signature-cream p-5 text-ink">
              <div className="flex items-center gap-2 text-[10px] font-medium tracking-[0.16em] text-[#41454d] uppercase">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Grounded answer
              </div>
              <p className="mt-4 text-lg leading-snug font-medium">
                Reset your password from Settings → Security.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-[#41454d]">
                <span className="rounded-md border border-[#e2d3ba] bg-white/50 px-2 py-1">
                  Product docs
                </span>
                <span className="rounded-md border border-[#e2d3ba] bg-white/50 px-2 py-1">
                  3 sources attached
                </span>
              </div>
            </div>

            <div className="ml-auto w-[78%] rounded-xl bg-signature-peach p-4 text-ink">
              <div className="flex items-center gap-2 text-[10px] font-medium tracking-[0.16em] text-[#41454d] uppercase">
                <FileText className="size-3.5" aria-hidden />
                Retrieval
              </div>
              <p className="mt-2 text-2xl leading-none font-normal tracking-[-0.03em]">
                Source-backed
              </p>
              <p className="mt-2 text-xs text-[#41454d]">
                Chunks, scores and latency stay visible for every attempt.
              </p>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-4 border-t border-white/15 pt-6 text-xs text-white/60">
            <div>
              <p className="text-white">01</p>
              <p className="mt-1 leading-5">Grounded retrieval</p>
            </div>
            <div>
              <p className="text-white">02</p>
              <p className="mt-1 leading-5">Inbox routing</p>
            </div>
            <div>
              <p className="text-white">03</p>
              <p className="mt-1 leading-5">Answer analytics</p>
            </div>
          </div>
        </div>

        <p className="flex items-center gap-2 text-[11px] text-white/40">
          <ShieldCheck className="size-3.5" aria-hidden />
          Internal operations dashboard
        </p>
      </aside>
    </main>
  );
}
