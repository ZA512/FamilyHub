import { describe, expect, it } from 'vitest';

import { notificationPreferenceSchema, pushSubscriptionSchema } from './index';

describe('notification preferences', () => {
  it('accepts level, muted modules and a quiet period', () => {
    expect(
      notificationPreferenceSchema.parse({
        level: 'IMPORTANT',
        mutedModules: ['chat', 'shopping'],
        quietStart: '22:30',
        quietEnd: '07:15',
      }),
    ).toEqual({
      level: 'IMPORTANT',
      mutedModules: ['chat', 'shopping'],
      quietStart: '22:30',
      quietEnd: '07:15',
    });
  });

  it('rejects essential modules and invalid times', () => {
    expect(
      notificationPreferenceSchema.safeParse({
        level: 'ALL',
        mutedModules: ['settings'],
        quietStart: '25:00',
        quietEnd: null,
      }).success,
    ).toBe(false);
  });

  it('validates secure Web Push subscriptions', () => {
    expect(
      pushSubscriptionSchema.safeParse({
        endpoint: 'https://push.example.test/subscription',
        keys: { p256dh: 'a'.repeat(40), auth: 'b'.repeat(16) },
      }).success,
    ).toBe(true);
    expect(
      pushSubscriptionSchema.safeParse({
        endpoint: 'http://push.example.test/subscription',
        keys: { p256dh: 'a'.repeat(40), auth: 'b'.repeat(16) },
      }).success,
    ).toBe(false);
  });
});
