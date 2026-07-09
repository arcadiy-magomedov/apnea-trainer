import { describe, it, expect } from 'vitest';
import { exportJson, importJson } from './jsonBackup';
import { emptyAppState } from '../../domain/models/appState';

describe('json backup', () => {
  it('exports then imports to an equal state', () => {
    const s = emptyAppState();
    s.settings.voiceCues = false;
    const round = importJson(exportJson(s));
    expect(round).toEqual(s);
  });

  it('rejects malformed json', () => {
    expect(() => importJson('not json')).toThrow(/invalid/i);
  });

  it('rejects an unsupported version', () => {
    expect(() => importJson(JSON.stringify({ version: 99 }))).toThrow(/version/i);
  });

  it('rejects a state missing required fields', () => {
    expect(() => importJson(JSON.stringify({ version: 1 }))).toThrow(/invalid/i);
  });
});
