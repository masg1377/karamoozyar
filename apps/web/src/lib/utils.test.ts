import { describe, it, expect } from 'vitest';
import { baseMimeType, extensionForMime, generateClientMessageId } from './utils';

describe('baseMimeType', () => {
  it('strips the codecs parameter (the voice-upload rejection bug)', () => {
    // MediaRecorder emits `audio/webm;codecs=opus`, which the server allow-list
    // (bare `audio/webm`) would otherwise reject.
    expect(baseMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseMimeType('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(baseMimeType('AUDIO/WEBM')).toBe('audio/webm');
    expect(baseMimeType('image/jpeg')).toBe('image/jpeg');
  });
});

describe('extensionForMime', () => {
  it('maps recorded audio / images to a sensible extension', () => {
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMime('audio/ogg')).toBe('ogg');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('application/x-tar')).toBe('bin'); // unknown → bin
  });
});

describe('generateClientMessageId', () => {
  it('produces unique ids of at least the validator minimum length (8)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generateClientMessageId();
      expect(id.length).toBeGreaterThanOrEqual(8);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });
});
