/// <reference types="jest" />
/**
 * The single-item intake's trail (2026-10-31): where an intake stopped, kept across a restart, and nothing about
 * the item. A freeze leaves no crash report; this is what the next report can read out.
 */
const mockStore = new Map<string, string>();
jest.mock('../lib/storage', () => ({
  __esModule: true,
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

import { INTAKE_STEPS, lastSafeStep, readIntakeTrail, recordIntakeStep, resetIntakeTrailForTests, sanitizeTrail } from '../lib/intake-trail';

declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(p: string, e: 'utf8'): string };

const at = (s: number) => new Date(Date.UTC(2026, 9, 31, 10, 0, s));

beforeEach(() => {
  mockStore.clear();
  resetIntakeTrailForTests();
});

it('keeps each step with its time, and survives a restart', async () => {
  recordIntakeStep('opened', at(1));
  recordIntakeStep('category', at(2));
  recordIntakeStep('submitted', at(3));
  await Promise.resolve();
  resetIntakeTrailForTests(); // a new launch of the app
  const read = await readIntakeTrail();
  expect(read.map((e) => e.step)).toEqual(['opened', 'category', 'submitted']);
  expect(read[2].at).toBe('2026-10-31T10:00:03Z');
  expect(lastSafeStep(read)).toBeNull();
});

it('names the last point that was safely on the server', () => {
  const trail = sanitizeTrail([
    { step: 'opened', at: '2026-10-31T10:00:01Z' },
    { step: 'committed', at: '2026-10-31T10:00:05Z' },
    { step: 'opened', at: '2026-10-31T10:01:00Z' },
    { step: 'uncertain', at: '2026-10-31T10:01:09Z' },
  ]);
  expect(lastSafeStep(trail)?.at).toBe('2026-10-31T10:00:05Z');
});

it('keeps nothing but a known step and a time: no product, code, amount or text can ride along', () => {
  const trail = sanitizeTrail([
    { step: 'opened', at: '2026-10-31T10:00:01Z', product: 'Logitech M185', imei: '356938035643809' },
    { step: 'Logitech M185', at: '2026-10-31T10:00:02Z' },
    { step: 'submitted', at: 'yesterday, 356938035643809' },
    'committed',
  ]);
  expect(trail).toEqual([{ step: 'opened', at: '2026-10-31T10:00:01Z' }]);
  recordIntakeStep('356938035643809' as never, at(9));
  expect(JSON.stringify([...mockStore.values()])).not.toMatch(/3569380|Logitech/);
});

it('keeps only the last twelve steps', () => {
  for (let i = 0; i < 20; i += 1) recordIntakeStep(INTAKE_STEPS[i % INTAKE_STEPS.length], at(i));
  expect(sanitizeTrail(JSON.parse([...mockStore.values()][0]))).toHaveLength(12);
});

it('the intake screen records every step, and every step has its words in all three languages', () => {
  const screen = readFileSync(`${__dirname}/../app/catalog/new.tsx`, 'utf8');
  for (const step of INTAKE_STEPS) expect({ step, recorded: screen.includes(`recordIntakeStep('${step}')`) }).toEqual({ step, recorded: true });
  for (const lang of ['en', 'fr', 'ar']) {
    const catalogue = readFileSync(`${__dirname}/../lib/i18n/${lang}.ts`, 'utf8');
    for (const step of INTAKE_STEPS) expect(catalogue).toContain(`'devices.intake.step.${step}'`);
  }
});
