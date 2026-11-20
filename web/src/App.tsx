import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '../../shared/types';
import { api, Link, navigate, post, usePath } from './lib';
import { AuthPage } from './pages/AuthPage';
import { BookingPage } from './pages/BookingPage';
import { Dashboard } from './pages/Dashboard';
import { ManageBooking } from './pages/ManageBooking';

export default function App() {
  const path = usePath();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api<User>('/api/me')
      .then(setUser)
      .catch(() => setUser(null)); // 401 = signed out
  }, []);

  const logout = async () => {
    await post('/api/auth/logout');
    setUser(null);
    navigate('/');
  };

  const segments = path.split('/').filter(Boolean);
  let page: ReactNode;
  if (path === '/login' || path === '/signup') {
    page = <AuthPage key={path} mode={path === '/login' ? 'login' : 'signup'} onAuth={setUser} />;
  } else if (path === '/dashboard') {
    if (user === undefined) page = <p className="center muted">Loading…</p>;
    else if (user === null) page = <AuthPage mode="login" onAuth={setUser} />;
    else page = <Dashboard user={user} />;
  } else if (segments[0] === 'booking' && segments[1]) {
    page = <ManageBooking token={segments[1]} />;
  } else if (segments.length === 2) {
    page = <BookingPage host={segments[0]!} event={segments[1]!} />;
  } else {
    page = <Landing signedIn={!!user} />;
  }

  return (
    <div className="page">
      <header className="masthead">
        <Link to="/" className="brand">
          <span aria-hidden="true">◷</span> Slotly
        </Link>
        <nav>
          {user ? (
            <>
              <Link to="/dashboard">Dashboard</Link>
              <button type="button" className="link-button" onClick={() => void logout()}>
                Sign out
              </button>
            </>
          ) : (
            user === null && (
              <>
                <Link to="/login">Sign in</Link>
                <Link to="/signup" className="button primary">
                  Get started
                </Link>
              </>
            )
          )}
        </nav>
      </header>
      <main>{page}</main>
    </div>
  );
}

function Landing({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="hero">
      <h1>Scheduling without the back-and-forth.</h1>
      <p className="muted">
        Share a link, let people pick a time that works in their time zone, and never get
        double-booked.
      </p>
      <Link to={signedIn ? '/dashboard' : '/signup'} className="button primary">
        {signedIn ? 'Go to dashboard' : 'Create your booking page'}
      </Link>
      <ul className="features">
        <li>
          <strong>Time-zone aware</strong>
          <span>
            Guests see slots in their local time; your hours stay correct through DST changes.
          </span>
        </li>
        <li>
          <strong>Never double-booked</strong>
          <span>A database constraint guarantees two people can't grab the same time.</span>
        </li>
        <li>
          <strong>Buffers & notice</strong>
          <span>Breathing room after meetings and no last-minute surprises.</span>
        </li>
      </ul>
    </section>
  );
}
