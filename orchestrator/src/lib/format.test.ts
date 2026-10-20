import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('octets, Ko et Mo inchangés', () => {
    expect(formatBytes(0)).toBe('0 o');
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(1536)).toBe('1,5 Ko');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 Mo');
    expect(formatBytes(null)).toBe('0 o');
  });

  it('à partir de 1 Gio : Go', () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,5 Go');
    expect(formatBytes(1024 ** 3)).toBe('1 Go');
  });
});
