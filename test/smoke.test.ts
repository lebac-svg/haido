import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

// Smoke test: proves the quality rig itself (tsc + eslint + prettier + vitest) runs green.
describe('rig', () => {
  it('exposes a semver version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('runs on Node >= 20', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(20);
  });
});
