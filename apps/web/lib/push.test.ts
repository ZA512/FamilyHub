import { describe, expect, it } from 'vitest';

import { urlBase64ToUint8Array } from './push';

describe('Web Push helpers', () => {
  it('decodes URL-safe base64 application keys', () => {
    expect([...urlBase64ToUint8Array('SGVsbG8td29ybGQ')]).toEqual([
      72, 101, 108, 108, 111, 45, 119, 111, 114, 108, 100,
    ]);
  });
});
