import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const optionalSecret = (minimum: number) =>
  z.preprocess((value) => (value === '' ? undefined : value), z.string().min(minimum).optional());

const optionalPort = z.preprocess(
  (value) => (value === '' || value === undefined ? 587 : value),
  z.coerce.number().int().min(1).max(65_535),
);

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    FAMILYHUB_ORIGIN: z.string().url().default('http://localhost:3000'),
    FAMILYHUB_TIMEZONE: z.string().min(1).default('Europe/Paris'),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    SESSION_SECRET: z.string().min(32),
    SETUP_TOKEN: z.string().min(24),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(8_760).default(720),
    TRUST_PROXY: booleanFromString,
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_024).max(1_073_741_824).default(26_214_400),
    ATTACHMENTS_DIR: z.string().min(1).default('/data/attachments'),
    VAPID_PUBLIC_KEY: optionalSecret(40),
    VAPID_PRIVATE_KEY: optionalSecret(20),
    VAPID_SUBJECT: optionalSecret(1),
    SMTP_HOST: optionalSecret(1),
    SMTP_PORT: optionalPort,
    SMTP_SECURE: booleanFromString,
    SMTP_USER: optionalSecret(1),
    SMTP_PASSWORD: optionalSecret(1),
    SMTP_FROM: optionalSecret(3),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((config, context) => {
    if (config.SESSION_SECRET === config.SETUP_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SESSION_SECRET et SETUP_TOKEN doivent être différents.',
        path: ['SESSION_SECRET'],
      });
    }

    const vapidValues = [config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY, config.VAPID_SUBJECT];
    if (vapidValues.some(Boolean) && !vapidValues.every(Boolean)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Les trois paramètres VAPID doivent être fournis ensemble.',
        path: ['VAPID_PUBLIC_KEY'],
      });
    }
    if (
      config.VAPID_SUBJECT &&
      !config.VAPID_SUBJECT.startsWith('mailto:') &&
      !config.VAPID_SUBJECT.startsWith('https://')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'VAPID_SUBJECT doit être une URL HTTPS ou mailto: valide.',
        path: ['VAPID_SUBJECT'],
      });
    }

    const smtpAuthValues = [config.SMTP_USER, config.SMTP_PASSWORD];
    if (smtpAuthValues.some(Boolean) && !smtpAuthValues.every(Boolean)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMTP_USER et SMTP_PASSWORD doivent être fournis ensemble.',
        path: ['SMTP_USER'],
      });
    }
    if ((config.SMTP_USER || config.SMTP_PASSWORD || config.SMTP_FROM) && !config.SMTP_HOST) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMTP_HOST est requis lorsque SMTP est configuré.',
        path: ['SMTP_HOST'],
      });
    }
    if (config.SMTP_HOST && (!config.SMTP_FROM || !config.SMTP_FROM.includes('@'))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMTP_FROM doit contenir une adresse email.',
        path: ['SMTP_FROM'],
      });
    }

    if (config.NODE_ENV === 'production') {
      for (const key of ['SESSION_SECRET', 'SETUP_TOKEN'] as const) {
        if (config[key].toLowerCase().includes('change-me')) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} contient encore une valeur d'exemple.`,
            path: [key],
          });
        }
      }

      const databasePassword = new URL(config.DATABASE_URL).password;
      if (config.DATABASE_URL.toLowerCase().includes('change-me') || databasePassword.length < 16) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DATABASE_URL doit contenir un mot de passe remplacé et suffisamment long.',
          path: ['DATABASE_URL'],
        });
      }

      const origin = new URL(config.FAMILYHUB_ORIGIN);
      const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
      if (origin.protocol !== 'https:' && !localHosts.has(origin.hostname)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'FAMILYHUB_ORIGIN doit utiliser HTTPS hors accès local.',
          path: ['FAMILYHUB_ORIGIN'],
        });
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'configuration'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration FamilyHub invalide :\n${details}`);
  }

  return parsed.data;
}
