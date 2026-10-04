import { expect, it } from 'vitest';
import { extensionMatchesPanel, usesCompanion } from '../src/shared/browser-mode.js';

it('uses personal Chrome by default even on localhost; companion is an explicit local choice', () => {
  expect(usesCompanion(true, 'extension')).toBe(false);
  expect(usesCompanion(true, 'companion')).toBe(true);
  expect(usesCompanion(false, 'companion')).toBe(false);
});
it('does not claim a connection when the extension writes to a different bank', () => {
  const local = { connected: true, endpoint: 'http://127.0.0.1:4300' };
  const cloud = { connected: true, endpoint: 'https://lead-radar-jade.vercel.app' };
  expect(extensionMatchesPanel(local, 'http://127.0.0.1:4300')).toBe(true);
  expect(extensionMatchesPanel(local, 'http://127.0.0.1:5173')).toBe(true);
  expect(extensionMatchesPanel(cloud, 'http://127.0.0.1:4300')).toBe(false);
  expect(extensionMatchesPanel(local, 'https://lead-radar-jade.vercel.app')).toBe(false);
  expect(extensionMatchesPanel(cloud, 'https://lead-radar-jade.vercel.app')).toBe(true);
  expect(extensionMatchesPanel({ ...cloud, connected: false }, 'https://lead-radar-jade.vercel.app')).toBe(false);
});
