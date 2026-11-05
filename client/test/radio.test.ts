import { afterEach, describe, expect, test, vi } from 'vitest';
import { Radio, type RadioKind } from '../src/audio/radio';

/** Minimal Web Audio stand-in: counts started/stopped sources. */
function fakeAudio() {
  const started = new Set<object>();
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), Q: param(), detune: param(), type: '' });
  const source = () => {
    const s = { ...node(), buffer: null as unknown, loop: false, start() { started.add(s); }, stop() { started.delete(s); } };
    return s;
  };
  let created = 0;
  const factory = () => {
    created++;
    return {
      currentTime: 0, sampleRate: 8000, state: 'running', destination: node(),
      createGain: node, createBiquadFilter: node, createBufferSource: source, createOscillator: source,
      createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
      resume: async () => {},
    } as unknown as AudioContext;
  };
  return { started, factory, created: () => created };
}

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

afterEach(() => vi.useRealTimers());

describe('Radio', () => {
  test('current() starts from the saved choice; play persists it', () => {
    const a = fakeAudio();
    const s = memStorage({ 'studyverse.radio': 'cafe' });
    const r = new Radio(s, a.factory);
    expect(r.current()).toBe('cafe');
    expect(a.created()).toBe(0); // nothing plays until play() (user gesture)
    r.play('lofi');
    expect(r.current()).toBe('lofi');
    expect(s.m.get('studyverse.radio')).toBe('lofi');
    r.play('off');
  });

  test('unknown saved value or throwing storage → off, no crash', () => {
    expect(new Radio(memStorage({ 'studyverse.radio': 'jazz' }), fakeAudio().factory).current()).toBe('off');
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const r = new Radio(broken, fakeAudio().factory);
    expect(r.current()).toBe('off');
    expect(() => r.play('rain')).not.toThrow();
    r.play('off');
  });

  test.each<RadioKind>(['rain', 'cafe', 'lofi'])('play(%s) starts sources; play(off) stops all of them', (kind) => {
    vi.useFakeTimers();
    const a = fakeAudio();
    const r = new Radio(memStorage(), a.factory);
    r.play(kind);
    vi.advanceTimersByTime(20_000); // scheduled clinks / chords
    expect(a.started.size).toBeGreaterThan(0);
    r.play('off');
    vi.advanceTimersByTime(1_000); // fade-out then stop
    expect(a.started.size).toBe(0);
    expect(r.current()).toBe('off');
    vi.advanceTimersByTime(30_000); // no more scheduling after off
    expect(a.started.size).toBe(0);
  });

  test('switching kinds stops the previous sound and reuses one AudioContext', () => {
    vi.useFakeTimers();
    const a = fakeAudio();
    const r = new Radio(memStorage(), a.factory);
    r.play('rain');
    const rainSources = new Set(a.started);
    r.play('cafe');
    vi.advanceTimersByTime(1_000);
    for (const s of rainSources) expect(a.started.has(s)).toBe(false);
    expect(a.started.size).toBeGreaterThan(0);
    expect(a.created()).toBe(1);
    r.play('off');
  });

  test('dispose() silences the radio but keeps the saved choice (restored next visit)', () => {
    vi.useFakeTimers();
    const a = fakeAudio();
    const s = memStorage();
    const r = new Radio(s, a.factory);
    r.play('rain');
    expect(a.started.size).toBeGreaterThan(0);
    r.dispose();
    vi.advanceTimersByTime(1000);
    expect(a.started.size).toBe(0);
    expect(s.m.get('studyverse.radio')).toBe('rain');
    expect(r.current()).toBe('rain');
  });
});
