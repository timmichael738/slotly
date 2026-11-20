import { z } from 'zod';

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Use lowercase letters, numbers and dashes');

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const timeZone = z.string().refine(isTimeZone, 'Unknown time zone');

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  password: z.string().min(10, 'At least 10 characters').max(200),
  slug: slug.min(3).max(40),
  timezone: timeZone,
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

export const eventTypeSchema = z.object({
  title: z.string().trim().min(1).max(100),
  slug: slug.min(2).max(50),
  description: z.string().max(1000).default(''),
  durationMin: z.number().int().min(5).max(480),
  bufferMin: z.number().int().min(0).max(120).default(0),
  active: z.boolean().default(true),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const availabilitySchema = z.object({
  timezone: timeZone,
  rules: z
    .array(
      z
        .object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm })
        .refine((r) => r.end > r.start, 'End must be after start'),
    )
    .max(50),
});

export const bookingSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  notes: z.string().max(2000).default(''),
  timezone: timeZone,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type EventTypeInput = z.infer<typeof eventTypeSchema>;
export type AvailabilityInput = z.infer<typeof availabilitySchema>;
export type AvailabilityRule = AvailabilityInput['rules'][number];
export type BookingInput = z.infer<typeof bookingSchema>;

export interface User {
  id: string;
  email: string;
  name: string;
  slug: string;
  timezone: string;
}

export interface EventType extends EventTypeInput {
  id: string;
}

export interface Booking {
  id: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteeTz: string;
  notes: string;
  status: 'confirmed' | 'cancelled';
}

export interface PublicEvent {
  host: { name: string; slug: string; timezone: string };
  event: { title: string; slug: string; description: string; durationMin: number };
}
