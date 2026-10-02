import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../../api/client';
import { ACCEPTED_TYPES, exceedsUploadLimit, sizeErrorMessage, uploadErrorMessage, uploadLimitMb } from './uploadPolicy';

const MB = 1024 * 1024;

describe('uploadPolicy', () => {
  it('suit la limite du serveur (MEDIA_MAX_MB), pas une valeur codée en dur', () => {
    expect(exceedsUploadLimit(12 * MB, uploadLimitMb(20))).toBe(false);
    expect(exceedsUploadLimit(5 * MB, uploadLimitMb(4))).toBe(true);
    expect(sizeErrorMessage(uploadLimitMb(4))).toBe('Image trop volumineuse (4 Mo maximum).');
  });

  it('limite inconnue : aucun refus côté navigateur, le serveur reste juge', () => {
    for (const v of [undefined, null, 0, -1, Number.NaN, '8']) expect(uploadLimitMb(v)).toBeNull();
    expect(exceedsUploadLimit(500 * MB, null)).toBe(false);
  });

  it('un 413 reprend le message du serveur (vraie limite)', () => {
    const err = new ApiError(413, 'Image trop volumineuse (4 Mo maximum).');
    expect(uploadErrorMessage(err, 8)).toBe('Image trop volumineuse (4 Mo maximum).');
    expect(uploadErrorMessage(new ApiError(413, ''), 4)).toBe('Image trop volumineuse (4 Mo maximum).');
  });

  it('AVIF accepté, SVG jamais', () => {
    expect(ACCEPTED_TYPES).toContain('image/avif');
    expect(ACCEPTED_TYPES).not.toContain('image/svg+xml');
  });
});
