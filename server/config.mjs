import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const date = z.iso.date();
const seat = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  label: z.string().min(1).max(40),
  type: z.enum(['fixed', 'rotating', 'flexible']),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});
const schema = z.object({
  siteName: z.string().min(1).max(100),
  organization: z.string().min(1).max(100),
  timeZone: z.string().min(1).max(100),
  registrationOpen: z.boolean(),
  applicationOpen: z.boolean(),
  seatTypes: z.object({
    flexible: z.object({
      label: z.string(),
      period: z.literal('days'),
      maxDays: z.number().int().min(1).max(365),
      description: z.string(),
    }),
    rotating: z.object({ label: z.string(), period: z.literal('month'), description: z.string() }),
    fixed: z.object({ label: z.string(), period: z.literal('term'), description: z.string() }),
  }),
  terms: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]+$/),
        label: z.string().min(1),
        start: date,
        end: date,
      }),
    )
    .default([]),
  rooms: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]+$/),
        name: z.string().min(1),
        description: z.string().default(''),
        width: z.number().positive(),
        height: z.number().positive(),
        seats: z.array(seat).min(1),
      }),
    )
    .min(1),
});

export function loadConfig(file = process.env.CONFIG_FILE ?? './config/site.example.json') {
  const config = schema.parse(JSON.parse(readFileSync(resolve(file), 'utf8')));
  const seats = config.rooms.flatMap((room) => room.seats);
  if (new Set(seats.map((s) => s.id)).size !== seats.length)
    throw new Error('工位 ID 必须全局唯一');
  if (new Set(config.rooms.map((r) => r.id)).size !== config.rooms.length)
    throw new Error('空间 ID 必须唯一');
  if (new Set(config.terms.map((t) => t.id)).size !== config.terms.length)
    throw new Error('学期 ID 必须唯一');
  if (config.terms.some((t) => t.end < t.start)) throw new Error('学期结束日期不能早于开始日期');
  return config;
}
