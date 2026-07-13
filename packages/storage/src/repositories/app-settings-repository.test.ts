import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStorage, type Storage } from '../storage';

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-app-settings-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('AppSettingsRepository (spec 29.2: telemetry opt-in, default OFF)', () => {
  it('defaults to telemetry disabled on a fresh install, with no row written', () => {
    expect(storage.appSettings.isTelemetryEnabled()).toBe(false);
    const row = storage.db.prepare('SELECT * FROM app_settings').all();
    expect(row).toEqual([]);
  });

  it('persists an explicit opt-in', () => {
    storage.appSettings.setTelemetryEnabled(true, '2026-07-13T00:00:00.000Z');
    expect(storage.appSettings.isTelemetryEnabled()).toBe(true);
  });

  it('persists opting back out again (round trip, not just one-way)', () => {
    storage.appSettings.setTelemetryEnabled(true, '2026-07-13T00:00:00.000Z');
    storage.appSettings.setTelemetryEnabled(false, '2026-07-13T00:01:00.000Z');
    expect(storage.appSettings.isTelemetryEnabled()).toBe(false);
  });

  it('survives reopening the same database file', () => {
    storage.appSettings.setTelemetryEnabled(true, '2026-07-13T00:00:00.000Z');
    const dbPath = path.join(dir, 'space.sqlite');
    storage.close();
    storage = createStorage(dbPath);
    expect(storage.appSettings.isTelemetryEnabled()).toBe(true);
  });
});
