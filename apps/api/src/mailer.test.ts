import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../../../packages/config/src/index.js';

const { createTransport, sendMail } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

import { sendInvitationEmail } from './mailer.js';

const baseEnvironment = {
  DATABASE_URL: 'postgresql://familyhub:long-database-password@localhost:5432/familyhub',
  SESSION_SECRET: 'a'.repeat(32),
  SETUP_TOKEN: 'b'.repeat(32),
};

describe('sendInvitationEmail', () => {
  beforeEach(() => {
    createTransport.mockReset();
    sendMail.mockReset();
    createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ accepted: ['member@example.com'] });
  });

  it('keeps manual invitations when SMTP is disabled', async () => {
    const sent = await sendInvitationEmail(loadConfig(baseEnvironment), {
      email: 'member@example.com',
      instanceName: 'Famille',
      inviteUrl: 'https://family.example/?invite=token',
    });
    expect(sent).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends an invitation without injecting its label into HTML', async () => {
    const config = loadConfig({
      ...baseEnvironment,
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'familyhub@example.com',
    });
    const sent = await sendInvitationEmail(config, {
      email: 'member@example.com',
      instanceName: '<script>alert(1)</script>',
      inviteUrl: 'https://family.example/?invite=a&next=b',
    });
    expect(sent).toBe(true);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587, secure: false }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'member@example.com',
        html: expect.not.stringContaining('<script>'),
      }),
    );
  });
});
