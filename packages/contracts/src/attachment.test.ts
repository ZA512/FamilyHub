import { describe, expect, it } from 'vitest';

import { uploadInitSchema } from './index.js';

describe('attachment contracts', () => {
  const baseUpload = {
    filename: 'photo.png',
    contentType: 'image/png',
    size: 128,
    clientMutationId: '3e7fef53-59bb-46e1-8873-e37f83d689bc',
  };

  it('conserve les anciens clients comme envois de ressources', () => {
    expect(uploadInitSchema.parse(baseUpload).purpose).toBe('RESOURCE');
  });

  it('accepte un envoi explicitement réservé à un avatar', () => {
    expect(uploadInitSchema.parse({ ...baseUpload, purpose: 'AVATAR' }).purpose).toBe('AVATAR');
  });

  it('refuse un usage de fichier inconnu', () => {
    expect(() => uploadInitSchema.parse({ ...baseUpload, purpose: 'EXECUTABLE' })).toThrow();
  });
});
