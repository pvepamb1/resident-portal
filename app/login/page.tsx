'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

type PhoneStep = 'enter-phone' | 'enter-code';

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Resident Portal -- Landlord sign-in</h1>

      <Suspense fallback={null}>
        <NotAuthorizedBanner />
      </Suspense>

      <section style={{ marginBottom: '2rem' }}>
        <GoogleSignIn />
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <PhoneSignIn />
      </section>

      <section>
        <MagicLinkSignIn />
      </section>
    </main>
  );
}

function NotAuthorizedBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get('error') !== 'not_authorized') return null;

  return (
    <p role="alert" style={{ color: '#a33', border: '1px solid #a33', padding: '0.75rem', borderRadius: 6 }}>
      You&apos;re not authorized to access this dashboard.
    </p>
  );
}

function GoogleSignIn() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <h2>Google</h2>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage(null);
          try {
            const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' });
            if (result.error) {
              setMessage(result.error.message ?? 'Could not sign in with Google.');
              setPending(false);
            }
            // On success the browser navigates away to Google/the callback
            // URL, so `pending` intentionally stays true until that happens.
          } catch {
            setMessage('Could not sign in with Google.');
            setPending(false);
          }
        }}
      >
        {pending ? 'Redirecting…' : 'Continue with Google'}
      </button>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}

function PhoneSignIn() {
  const router = useRouter();
  const [step, setStep] = useState<PhoneStep>('enter-phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <h2>Phone + OTP</h2>
      {step === 'enter-phone' ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setMessage(null);
            const result = await authClient.phoneNumber.sendOtp({ phoneNumber });
            setPending(false);
            if (result.error) {
              setMessage(result.error.message ?? 'Could not send the code.');
              return;
            }
            setStep('enter-code');
          }}
        >
          <label>
            Phone number
            <input
              type="tel"
              required
              placeholder="+91 98765 43210"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setMessage(null);
            const result = await authClient.phoneNumber.verify({ phoneNumber, code });
            setPending(false);
            if (result.error) {
              setMessage(result.error.message ?? 'That code did not work.');
              return;
            }
            router.push('/dashboard');
          }}
        >
          <label>
            Enter the code sent to {phoneNumber}
            <input
              type="text"
              inputMode="numeric"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}

function MagicLinkSignIn() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <h2>Email magic link</h2>
      {sent ? (
        <p>Check {email} for a sign-in link.</p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setMessage(null);
            const result = await authClient.signIn.magicLink({ email, callbackURL: '/dashboard' });
            setPending(false);
            if (result.error) {
              setMessage(result.error.message ?? 'Could not send the link.');
              return;
            }
            setSent(true);
          }}
        >
          <label>
            Email address
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
