type SupportedLocale = 'fr' | 'en';

const englishTitles: Record<string, string> = {
  AGENDA_INVITATION: 'New event',
  BOOKMARK_SHARED: 'New shared bookmark',
  COLLECTION_ITEM_ADDED: 'New item in a collection',
  COLLECTION_SHARED: 'New shared collection',
  CONTACT_SHARED: 'New shared contact',
  DOCUMENT_SHARED: 'New shared document',
  IDEA_SHARED: 'New idea',
  PAGE_SHARED: 'Shared page',
  POLL_SHARED: 'New poll',
  SHOPPING_REQUEST_ADDED: 'New shopping request',
  TASK_ASSIGNED: 'New assigned task',
};

const englishBodies: Partial<Record<string, (body: string) => string>> = {
  BOOKMARK_SHARED: (body) => replace(body, /^(.+) recommande : (.*)$/s, '$1 recommends: $2'),
  COLLECTION_ITEM_ADDED: (body) =>
    replace(body, /^(.+) ajoute « (.*) » dans « (.*) »$/s, '$1 added “$2” to “$3”'),
  COLLECTION_SHARED: (body) => replace(body, /^(.+) partage « (.*) »$/s, '$1 shared “$2”'),
  CONTACT_SHARED: (body) =>
    replace(body, /^(.+) partage le contact « (.*) »$/s, '$1 shared the contact “$2”'),
  DOCUMENT_SHARED: (body) => replace(body, /^(.+) partage « (.*) »$/s, '$1 shared “$2”'),
  IDEA_SHARED: (body) => replace(body, /^(.+) propose : « (.*) »$/s, '$1 suggests: “$2”'),
  PAGE_SHARED: (body) => replace(body, /^(.+) a partagé : (.*)$/s, '$1 shared: $2'),
  POLL_SHARED: (body) =>
    replace(body, /^(.+) vous propose : « (.*) »$/s, '$1 asks you: “$2”'),
};

function replace(body: string, pattern: RegExp, replacement: string) {
  return pattern.test(body) ? body.replace(pattern, replacement) : body;
}

export function localizeNotification<
  T extends { type: string; title: string; body: string | null },
>(
  locale: SupportedLocale | undefined,
  notification: T,
): T {
  if (locale !== 'en') return notification;
  const translateBody = englishBodies[notification.type];
  return {
    ...notification,
    title: englishTitles[notification.type] ?? notification.title,
    body:
      notification.type === 'CHAT_MESSAGE' && notification.body === 'Message supprimé'
        ? 'Message deleted'
        : notification.body && translateBody
          ? translateBody(notification.body)
          : notification.body,
  } as T;
}
