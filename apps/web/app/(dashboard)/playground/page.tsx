import { redirect } from 'next/navigation';

export const metadata = { title: 'Sandbox' };

/** The Playground became the Try it tab inside the Sandbox (docs/product/sandbox.md). */
export default function PlaygroundPage() {
  redirect('/sandbox');
}
