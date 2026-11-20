// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { groupByLocalDate, monthGrid } from './lib';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('lib', () => {
  it('builds a Monday-first month grid', () => {
    const grid = monthGrid(2026, 11); // December 2026 starts on a Tuesday
    expect(grid.slice(0, 2)).toEqual([null, '2026-12-01']);
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it("groups UTC slots by the viewer's local date", () => {
    const slots = ['2026-12-07T23:30:00Z', '2026-12-08T09:00:00Z'];
    expect([...groupByLocalDate(slots, 'UTC').keys()]).toEqual(['2026-12-07', '2026-12-08']);
    // In Tokyo (UTC+9) both instants fall on 8 December.
    expect([...groupByLocalDate(slots, 'Asia/Tokyo').entries()]).toEqual([['2026-12-08', slots]]);
  });
});

describe('public booking page', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-01T12:00:00Z') });
    history.replaceState(null, '', '/ada/30min');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('picks a day and time and books it', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/me') return json({ error: 'Sign in required' }, 401);
      if (url === '/api/public/ada/30min')
        return json({
          host: { name: 'Ada Lovelace', slug: 'ada', timezone: 'Europe/London' },
          event: { title: 'Intro call', slug: '30min', description: 'Say hi', durationMin: 30 },
        });
      if (url.startsWith('/api/public/ada/30min/slots'))
        return json({ slots: ['2026-12-07T09:00:00Z', '2026-12-07T09:30:00Z'] });
      if (url === '/api/public/ada/30min/book' && init?.method === 'POST')
        return json({ id: '1', cancelToken: 'tok_abcdefghijklmnopqrstuvwxyz' }, 201);
      throw new Error(`unexpected ${url}`);
    });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Intro call' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Time zone'), 'UTC');
    await user.click(
      await screen.findByRole('gridcell', { name: /2026-12-07, 2 times available/ }),
    );
    await user.click(screen.getByRole('button', { name: /9:00/ }));
    await user.type(screen.getByLabelText('Your name'), 'Grace Hopper');
    await user.type(screen.getByLabelText('Email'), 'grace@example.com');
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByRole('heading', { name: "You're booked!" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Manage or cancel/ })).toHaveAttribute(
      'href',
      '/booking/tok_abcdefghijklmnopqrstuvwxyz',
    );
    const bookCall = fetchMock.mock.calls.find(([u]) => u === '/api/public/ada/30min/book')!;
    expect(JSON.parse(bookCall[1].body)).toMatchObject({
      start: '2026-12-07T09:00:00Z',
      name: 'Grace Hopper',
      timezone: 'UTC',
    });
  });

  it('refreshes slots and explains when a slot was just taken', async () => {
    let slotsCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/me') return json({}, 401);
      if (url === '/api/public/ada/30min')
        return json({
          host: { name: 'Ada', slug: 'ada', timezone: 'UTC' },
          event: { title: 'Intro call', slug: '30min', description: '', durationMin: 30 },
        });
      if (url.startsWith('/api/public/ada/30min/slots')) {
        slotsCalls++;
        return json({ slots: ['2026-12-07T09:00:00Z'] });
      }
      return json({ error: 'Someone just booked that time. Please pick another slot.' }, 409);
    });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<App />);
    await user.selectOptions(await screen.findByLabelText('Time zone'), 'UTC');
    await user.click(
      await screen.findByRole('gridcell', { name: /2026-12-07, 1 times available/ }),
    );
    await user.click(screen.getByRole('button', { name: /9:00/ }));
    await user.type(screen.getByLabelText('Your name'), 'X');
    await user.type(screen.getByLabelText('Email'), 'x@example.com');
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone just booked that time');
    await waitFor(() => expect(slotsCalls).toBe(2));
  });
});
