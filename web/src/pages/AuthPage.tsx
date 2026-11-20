import { useState, type FormEvent } from 'react';
import type { User } from '../../../shared/types';
import { browserTimeZone, Link, navigate, post } from '../lib';

export function AuthPage({
  mode,
  onAuth,
}: {
  mode: 'login' | 'signup';
  onAuth: (user: User) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      const user = await post<User>(
        signup ? '/api/auth/signup' : '/api/auth/login',
        signup ? { ...form, timezone: browserTimeZone() } : form,
      );
      onAuth(user);
      navigate('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card narrow auth" onSubmit={submit}>
      <h1>{signup ? 'Create your booking page' : 'Welcome back'}</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {signup && (
        <label>
          Name
          <input name="name" required autoComplete="name" />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          required
          minLength={signup ? 10 : 1}
          autoComplete={signup ? 'new-password' : 'current-password'}
        />
      </label>
      {signup && (
        <label>
          Page URL
          <span className="prefix-input">
            <span>{location.host}/</span>
            <input
              name="slug"
              required
              pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
              placeholder="your-name"
            />
          </span>
        </label>
      )}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
      </button>
      <p className="muted">
        {signup ? (
          <>
            Already have an account? <Link to="/login">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link to="/signup">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
