'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button, Card } from '@/app/_components/ui';

/**
 * Sign-in. Email only — a magic link, no password.
 *
 * In local development no mail is sent; the link is printed to the server
 * console by `sendMagicLink` in src/lib/auth.ts. The page says so plainly
 * rather than claiming an email is on its way.
 */
type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

const DEV = process.env.NODE_ENV !== 'production';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;

    setState({ kind: 'sending' });
    const { error } = await authClient.signIn.magicLink({
      email: address,
      callbackURL: '/geo',
    });

    setState(
      error
        ? { kind: 'error', message: error.message ?? 'Could not send the link. Try again.' }
        : { kind: 'sent' }
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          <span className="font-mono text-[13px] font-medium tracking-[0.18em]">GEO</span>
        </div>

        <Card className="px-6 py-6">
          <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.01em]">Sign in</h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            Track how AI assistants talk about your brand.
          </p>

          {state.kind === 'sent' ? (
            <div className="mt-5">
              <p className="text-sm font-medium">Check your email</p>
              <p className="mt-1.5 text-[13px] text-ink-muted">
                We sent a sign-in link to <span className="font-medium text-ink">{email}</span>. It
                expires in 10 minutes.
              </p>
              {DEV ? (
                <p className="mt-3 rounded-md border border-hairline px-3 py-2 text-[12px] text-ink-muted">
                  No mail is configured in development. The link was printed to the server console
                  running <span className="font-mono">npm run dev</span>.
                </p>
              ) : null}
              <button
                type="button"
                className="mt-4 text-[13px] text-ink-muted underline underline-offset-4 hover:text-ink"
                onClick={() => setState({ kind: 'idle' })}
              >
                Use a different address
              </button>
            </div>
          ) : (
            <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-[13px] font-medium">
                  Work email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="rounded-md border border-hairline-strong bg-canvas px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                />
              </div>

              {state.kind === 'error' ? (
                <p role="alert" className="text-[13px] text-down">
                  {state.message}
                </p>
              ) : null}

              <Button type="submit" variant="primary" disabled={state.kind === 'sending'}>
                {state.kind === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
              </Button>
            </form>
          )}
        </Card>

        <p className="mt-4 text-center text-[12px] text-ink-muted">
          No password. We email you a link that signs you in.
        </p>
      </div>
    </main>
  );
}
