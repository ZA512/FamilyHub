import type { AppConfig } from '@familyhub/config';
import nodemailer from 'nodemailer';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

export async function sendInvitationEmail(
  config: AppConfig,
  invitation: { email: string; instanceName: string; inviteUrl: string },
): Promise<boolean> {
  if (!config.SMTP_HOST || !config.SMTP_FROM) return false;

  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth:
      config.SMTP_USER && config.SMTP_PASSWORD
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
  });
  const instanceName = escapeHtml(invitation.instanceName);
  const inviteUrl = escapeHtml(invitation.inviteUrl);
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: invitation.email,
    subject: `Invitation à rejoindre ${invitation.instanceName} sur FamilyHub`,
    text: `Vous êtes invité à rejoindre ${invitation.instanceName} sur FamilyHub. Ce lien est valable sept jours : ${invitation.inviteUrl}`,
    html: `<p>Vous êtes invité à rejoindre <strong>${instanceName}</strong> sur FamilyHub.</p><p><a href="${inviteUrl}">Accepter l’invitation</a></p><p>Ce lien est valable sept jours.</p>`,
  });
  return true;
}
