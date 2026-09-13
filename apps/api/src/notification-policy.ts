export const importantNotificationTypes = [
  'AGENDA_INVITATION',
  'TASK_ASSIGNED',
  'CHAT_MESSAGE',
  'POLL_SHARED',
] as const;

export function isImportantNotification(type: string) {
  return (importantNotificationTypes as readonly string[]).includes(type);
}
