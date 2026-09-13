import { access } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { AppConfig } from '@familyhub/config';
import { ZipArchive } from 'archiver';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createSessionGuard } from './auth.js';

type Row = Record<string, unknown>;

function serialize(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows: Row[]) {
  if (!rows.length) return '\uFEFF';
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `\uFEFF${columns.map(csvCell).join(',')}\r\n${rows
    .map((row) => columns.map((column) => csvCell(row[column])).join(','))
    .join('\r\n')}\r\n`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function bookmarksToHtml(bookmarks: Row[]) {
  const links = bookmarks
    .map(
      (bookmark) =>
        `<DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${Math.floor(
          new Date(String(bookmark.created_at)).getTime() / 1_000,
        )}">${escapeHtml(bookmark.title)}</A>${bookmark.description ? `<DD>${escapeHtml(bookmark.description)}` : ''}`,
    )
    .join('\n');
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>FamilyHub</TITLE>\n<H1>FamilyHub</H1>\n<DL><p>\n${links}\n</DL><p>\n`;
}

function icsText(value: unknown) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

function icsDate(value: unknown, allDay = false) {
  const date = new Date(String(value));
  if (allDay) return date.toISOString().slice(0, 10).replaceAll('-', '');
  return date
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function calendarToIcs(events: Row[], tasks: Row[], calendarName: string) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FamilyHub//Export//FR',
    `X-WR-CALNAME:${icsText(calendarName)}`,
    'CALSCALE:GREGORIAN',
  ];
  for (const event of events) {
    const allDay = Boolean(event.all_day);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@familyhub`,
      `DTSTAMP:${icsDate(event.updated_at ?? event.created_at)}`,
      `${allDay ? 'DTSTART;VALUE=DATE' : 'DTSTART'}:${icsDate(event.start_at, allDay)}`,
      `${allDay ? 'DTEND;VALUE=DATE' : 'DTEND'}:${icsDate(event.end_at, allDay)}`,
      `SUMMARY:${icsText(event.title)}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${icsText(event.location)}`);
    lines.push('END:VEVENT');
  }
  for (const task of tasks) {
    if (!task.due_at && !task.period_start_at) continue;
    lines.push(
      'BEGIN:VTODO',
      `UID:${task.id}@familyhub-task`,
      `DTSTAMP:${icsDate(task.updated_at ?? task.created_at)}`,
      `DUE:${icsDate(task.due_at ?? task.period_start_at)}`,
      `SUMMARY:${icsText(task.title)}`,
      `STATUS:${task.status === 'DONE' ? 'COMPLETED' : task.status === 'CANCELLED' ? 'CANCELLED' : 'NEEDS-ACTION'}`,
    );
    if (task.description) lines.push(`DESCRIPTION:${icsText(task.description)}`);
    lines.push('END:VTODO');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function markdownText(node: Row): string {
  let text = typeof node.text === 'string' ? node.text : '';
  const marks = Array.isArray(node.marks) ? (node.marks as Row[]) : [];
  for (const mark of marks) {
    if (mark.type === 'bold') text = `**${text}**`;
    if (mark.type === 'italic') text = `*${text}*`;
    if (mark.type === 'link')
      text = `[${text}](${String((mark.attrs as Row | undefined)?.href ?? '')})`;
  }
  return text;
}

function contentMarkdown(nodes: unknown, depth = 0): string {
  if (!Array.isArray(nodes)) return '';
  return nodes
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return '';
      const node = candidate as Row;
      const children = contentMarkdown(node.content, depth + 1);
      if (node.type === 'text') return markdownText(node);
      if (node.type === 'hardBreak') return '  \n';
      if (node.type === 'heading')
        return `${'#'.repeat(Number((node.attrs as Row | undefined)?.level ?? 2))} ${children}\n\n`;
      if (node.type === 'paragraph') return `${children}\n\n`;
      if (node.type === 'blockquote') return `> ${children.trim().replaceAll('\n', '\n> ')}\n\n`;
      if (node.type === 'bulletList')
        return (
          children
            .split('\n')
            .filter(Boolean)
            .map((line) => `${'  '.repeat(depth)}- ${line}`)
            .join('\n') + '\n\n'
        );
      if (node.type === 'orderedList')
        return (
          children
            .split('\n')
            .filter(Boolean)
            .map((line, index) => `${index + 1}. ${line}`)
            .join('\n') + '\n\n'
        );
      if (node.type === 'listItem' || node.type === 'taskItem') return children.trimEnd();
      if (node.type === 'taskList') return `${children}\n\n`;
      if (node.type === 'image')
        return `![${String((node.attrs as Row | undefined)?.alt ?? '')}](${String((node.attrs as Row | undefined)?.src ?? '')})\n\n`;
      if (node.type === 'table') return `${children}\n`;
      if (node.type === 'tableRow') return `| ${children.trim().replaceAll('\n', ' | ')} |\n`;
      if (node.type === 'tableCell' || node.type === 'tableHeader') return children.trim();
      return children;
    })
    .join('');
}

export function pageToMarkdown(page: Row) {
  const content = page.content as Row | undefined;
  return `# ${String(page.title ?? 'Page')}\n\n${contentMarkdown(content?.content).trim()}\n`;
}

function safeName(value: unknown) {
  const normalized = String(value ?? 'sans-titre')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'sans-titre';
}

async function rows(pool: Pool, query: string, parameters: unknown[] = []) {
  return (await pool.query<Row>(query, parameters)).rows;
}

async function childRows(pool: Pool, table: string, column: string, ids: string[]) {
  if (!ids.length) return [];
  return rows(pool, `SELECT * FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [ids]);
}

export async function registerExportRoutes(app: FastifyInstance, pool: Pool, config: AppConfig) {
  const requireSession = createSessionGuard(pool);

  app.get<{ Params: { scope: string } }>(
    '/api/v1/exports/:scope',
    {
      preHandler: requireSession,
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const session = request.session!;
      const full = request.params.scope === 'instance';
      if (!full && request.params.scope !== 'personal')
        return reply.code(404).send({ error: 'EXPORT_NOT_FOUND' });
      if (full && session.role !== 'ADMIN')
        return reply.code(403).send({ error: 'ADMIN_REQUIRED' });

      const instance = (
        await rows(
          pool,
          'SELECT id, name, timezone, locale, created_at FROM instance WHERE id = $1',
          [session.instanceId],
        )
      )[0]!;
      const memberRows = await rows(
        pool,
        `SELECT m.id, m.role, m.status, m.joined_at, u.email, u.first_name, u.last_name,
                u.birth_date, u.phone, u.timezone
         FROM instance_member m JOIN app_user u ON u.id = m.user_id
         WHERE m.instance_id = $1 AND ($2::boolean OR m.id = $3)
         ORDER BY u.first_name`,
        [session.instanceId, full, session.id],
      );
      const groupRows = await rows(
        pool,
        `SELECT g.* FROM member_group g
         WHERE g.instance_id = $1 AND ($2::boolean OR EXISTS (
           SELECT 1 FROM group_membership gm WHERE gm.group_id = g.id AND gm.member_id = $3
         ))`,
        [session.instanceId, full, session.id],
      );
      const groupIds = groupRows.map((row) => String(row.id));
      const memberships = await childRows(pool, 'group_membership', 'group_id', groupIds);
      const resourceRows = await rows(
        pool,
        `SELECT * FROM resource r
         WHERE r.instance_id = $1 AND r.deleted_at IS NULL
           AND (
             $2::boolean OR r.created_by = $3 OR r.visibility = 'ALL_MEMBERS'
             OR (r.visibility = 'SELECTED_USERS' AND EXISTS (
               SELECT 1 FROM resource_acl_user rau
               WHERE rau.resource_id = r.id AND rau.member_id = $3
             ))
             OR (r.visibility = 'GROUPS' AND EXISTS (
               SELECT 1 FROM resource_acl_group rag
               JOIN group_membership gm ON gm.group_id = rag.group_id
               WHERE rag.resource_id = r.id AND gm.member_id = $3
             ))
           )
         ORDER BY r.created_at`,
        [session.instanceId, full, session.id],
      );
      const resourceIds = resourceRows.map((row) => String(row.id));

      const [
        tasks = [],
        events = [],
        meals = [],
        bookmarks = [],
        pages = [],
        collections = [],
        polls = [],
        ideas = [],
        contacts = [],
        documents = [],
      ] = await Promise.all(
        [
          'family_task',
          'calendar_event',
          'meal',
          'bookmark',
          'page',
          'collection',
          'poll',
          'idea',
          'contact',
          'document',
        ].map((table) => childRows(pool, table, 'id', resourceIds)),
      );
      const taskIds = tasks.map((row) => String(row.id));
      const eventIds = events.map((row) => String(row.id));
      const mealIds = meals.map((row) => String(row.id));
      const bookmarkIds = bookmarks.map((row) => String(row.id));
      const pageIds = pages.map((row) => String(row.id));
      const collectionIds = collections.map((row) => String(row.id));
      const pollIds = polls.map((row) => String(row.id));
      const ideaIds = ideas.map((row) => String(row.id));

      const conversationRows = await rows(
        pool,
        `SELECT c.* FROM conversation c
         WHERE c.instance_id = $1 AND c.deleted_at IS NULL AND ($2::boolean OR EXISTS (
           SELECT 1 FROM conversation_member cm WHERE cm.conversation_id = c.id AND cm.member_id = $3
         ))`,
        [session.instanceId, full, session.id],
      );
      const conversationIds = conversationRows.map((row) => String(row.id));
      const messageRows = await childRows(pool, 'message', 'conversation_id', conversationIds);
      const messageIds = messageRows.map((row) => String(row.id));
      const collectionItems = await childRows(
        pool,
        'collection_item',
        'collection_id',
        collectionIds,
      );
      const collectionItemIds = collectionItems.map((row) => String(row.id));

      const [
        completions,
        participants,
        mealIngredients,
        mealPreferences,
        bookmarkTags,
        bookmarkFavorites,
        bookmarkReactions,
        pageRevisions,
        pageLinks,
        collectionItemTags,
        collectionPreferences,
        collectionComments,
        pollOptions,
        ideaReactions,
        ideaComments,
        ideaConversions,
        conversationMembers,
        messageReactions,
        messageAttachments,
      ] = await Promise.all([
        childRows(pool, 'task_completion', 'task_id', taskIds),
        childRows(pool, 'calendar_event_participant', 'event_id', eventIds),
        childRows(pool, 'meal_ingredient', 'meal_id', mealIds),
        childRows(pool, 'meal_preference', 'meal_id', mealIds),
        childRows(pool, 'resource_tag', 'resource_id', bookmarkIds),
        childRows(pool, 'favorite', 'resource_id', bookmarkIds),
        childRows(pool, 'bookmark_reaction', 'bookmark_id', bookmarkIds),
        childRows(pool, 'page_revision', 'page_id', pageIds),
        childRows(pool, 'page_link', 'source_page_id', pageIds),
        childRows(pool, 'collection_item_tag', 'item_id', collectionItemIds),
        childRows(pool, 'collection_item_preference', 'item_id', collectionItemIds),
        childRows(pool, 'collection_item_comment', 'item_id', collectionItemIds),
        childRows(pool, 'poll_option', 'poll_id', pollIds),
        childRows(pool, 'idea_reaction', 'idea_id', ideaIds),
        childRows(pool, 'idea_comment', 'idea_id', ideaIds),
        childRows(pool, 'idea_conversion', 'idea_id', ideaIds),
        childRows(pool, 'conversation_member', 'conversation_id', conversationIds),
        childRows(pool, 'message_reaction', 'message_id', messageIds),
        childRows(pool, 'message_attachment', 'message_id', messageIds),
      ]);
      const pollOptionsIds = pollOptions.map((row) => String(row.id));
      const pollVotes = await childRows(pool, 'poll_vote', 'option_id', pollOptionsIds);
      const ingredientIds = mealIngredients.map((row) => String(row.ingredient_id));
      const ingredientRows = await childRows(pool, 'ingredient', 'id', ingredientIds);
      const resourceAclGroups = await childRows(
        pool,
        'resource_acl_group',
        'resource_id',
        resourceIds,
      );
      const resourceAclUsers = await childRows(
        pool,
        'resource_acl_user',
        'resource_id',
        resourceIds,
      );
      const tags = await rows(pool, 'SELECT * FROM tag WHERE instance_id = $1', [
        session.instanceId,
      ]);
      const shopping = await rows(
        pool,
        `SELECT * FROM shopping_item WHERE instance_id = $1 AND deleted_at IS NULL
           AND ($2::boolean OR requested_by = $3 OR purchased_by = $3)`,
        [session.instanceId, full, session.id],
      );
      const mealPlan = await rows(
        pool,
        `SELECT * FROM meal_plan_entry WHERE instance_id = $1
           AND ($2::boolean OR created_by = $3)`,
        [session.instanceId, full, session.id],
      );
      const notifications = await rows(
        pool,
        `SELECT * FROM notification WHERE instance_id = $1
           AND ($2::boolean OR recipient_member_id = $3)`,
        [session.instanceId, full, session.id],
      );
      const notificationPreferences = await rows(
        pool,
        `SELECT * FROM notification_preference WHERE instance_id = $1
           AND ($2::boolean OR member_id = $3)`,
        [session.instanceId, full, session.id],
      );
      const auditLogs = full
        ? await rows(pool, 'SELECT * FROM admin_audit_log WHERE instance_id = $1', [
            session.instanceId,
          ])
        : [];

      const attachmentIds = new Set([
        ...messageAttachments.map((row) => String(row.attachment_id)),
        ...documents.map((row) => String(row.attachment_id)),
      ]);
      const attachments = await rows(
        pool,
        `SELECT * FROM attachment WHERE instance_id = $1 AND status = 'READY'
          AND ($2::boolean OR uploaded_by = $3 OR id = ANY($4::uuid[]))`,
        [session.instanceId, full, session.id, [...attachmentIds]],
      );

      const archive = new ZipArchive({ zlib: { level: 6 } });
      archive.on('warning', (error: Error) =>
        request.log.warn({ error }, 'Export archive warning'),
      );
      archive.on('error', (error: Error) => request.log.error({ error }, 'Export archive failed'));
      const addJson = (name: string, value: unknown) => archive.append(serialize(value), { name });
      const exportedAt = new Date().toISOString();
      addJson('manifest.json', {
        format: 'familyhub-export',
        version: 1,
        scope: full ? 'instance' : 'personal',
        exportedAt,
        instance,
        exportedBy: session.id,
      });
      addJson('members.json', { members: memberRows, groups: groupRows, memberships });
      addJson('permissions.json', {
        resources: resourceRows,
        groupRules: resourceAclGroups,
        userRules: resourceAclUsers,
      });
      addJson('tasks.json', { tasks, completions });
      archive.append(rowsToCsv(tasks), { name: 'tasks.csv' });
      addJson('calendar.json', { events, participants });
      archive.append(calendarToIcs(events, tasks, String(instance.name)), {
        name: 'calendar.ics',
      });
      addJson('meals.json', {
        meals,
        ingredients: ingredientRows,
        mealIngredients,
        preferences: mealPreferences,
        planning: mealPlan,
      });
      addJson('shopping.json', shopping);
      addJson('bookmarks.json', {
        bookmarks,
        tags,
        resourceTags: bookmarkTags,
        favorites: bookmarkFavorites,
        reactions: bookmarkReactions,
      });
      archive.append(bookmarksToHtml(bookmarks), { name: 'bookmarks.html' });
      addJson('pages/pages.json', { pages, revisions: pageRevisions, links: pageLinks });
      for (const page of pages) {
        archive.append(pageToMarkdown(page), {
          name: `pages/${safeName(page.title)}-${String(page.id).slice(0, 8)}.md`,
        });
      }
      addJson('collections.json', {
        collections,
        items: collectionItems,
        itemTags: collectionItemTags,
        preferences: collectionPreferences,
        comments: collectionComments,
      });
      archive.append(rowsToCsv(collectionItems), { name: 'collections.csv' });
      addJson('polls.json', { polls, options: pollOptions, votes: pollVotes });
      addJson('ideas.json', {
        ideas,
        reactions: ideaReactions,
        comments: ideaComments,
        conversions: ideaConversions,
      });
      addJson('contacts.json', contacts);
      addJson('documents.json', documents);
      addJson('chat.json', {
        conversations: conversationRows,
        members: conversationMembers,
        messages: messageRows,
        reactions: messageReactions,
        attachments: messageAttachments,
      });
      addJson('notifications.json', {
        notifications,
        preferences: notificationPreferences,
      });
      if (full) addJson('administration/audit-log.json', auditLogs);
      addJson(
        'attachments/metadata.json',
        attachments.map(({ storage_key: _storageKey, ...attachment }) => attachment),
      );
      for (const attachment of attachments) {
        const filePath = join(config.ATTACHMENTS_DIR, String(attachment.storage_key));
        try {
          await access(filePath);
          archive.file(filePath, {
            name: `attachments/${String(attachment.id)}-${safeName(basename(String(attachment.original_filename)))}`,
          });
        } catch {
          request.log.warn({ attachmentId: attachment.id }, 'Export attachment missing');
        }
      }

      await pool.query(
        `INSERT INTO admin_audit_log
          (instance_id, actor_member_id, action, target_type, target_id, details)
         VALUES ($1, $2, $3, 'instance', $1, $4::jsonb)`,
        [
          session.instanceId,
          session.id,
          full ? 'instance.exported' : 'member.exported',
          JSON.stringify({ exportedAt }),
        ],
      );

      const date = exportedAt.slice(0, 10);
      reply
        .type('application/zip')
        .header(
          'content-disposition',
          `attachment; filename="familyhub-${full ? 'instance' : 'personnel'}-${date}.zip"`,
        )
        .header('cache-control', 'no-store');
      void archive.finalize();
      return reply.send(archive);
    },
  );
}
