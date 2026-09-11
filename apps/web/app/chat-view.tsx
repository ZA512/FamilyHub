import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  ArrowLeft,
  CornerUpLeft,
  Download,
  FileText,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Plus,
  Send,
  Users,
  X,
} from 'lucide-react';

import type {
  ChatMessage,
  ChatReaction,
  ChatRealtimeEvent,
  ConversationSummary,
  ConversationType,
  FamilyMember,
} from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const reactions: ChatReaction[] = ['👍', '❤️', '😂', '😮', '😢', '👏'];

type ChatViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

export function ChatView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: ChatViewProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [maxUploadBytes, setMaxUploadBytes] = useState(25 * 1024 * 1024);
  const [uploadingLabel, setUploadingLabel] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  const loadConversations = useCallback(async () => {
    const response = await fetch('/api/v1/conversations');
    if (!response.ok)
      throw new Error('Impossible de charger les conversations.');
    const payload = (await response.json()) as ConversationSummary[];
    setConversations(payload);
    setSelectedId((current) => current ?? payload[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/conversations', { signal: controller.signal }),
      fetch('/api/v1/members', { signal: controller.signal }),
    ])
      .then(async ([conversationResponse, memberResponse]) => {
        if (!conversationResponse.ok || !memberResponse.ok) {
          throw new Error('Impossible de charger la messagerie.');
        }
        return Promise.all([
          conversationResponse.json() as Promise<ConversationSummary[]>,
          memberResponse.json() as Promise<{ members: FamilyMember[] }>,
        ]);
      })
      .then(([conversationPayload, memberPayload]) => {
        setConversations(conversationPayload);
        setMembers(
          memberPayload.members.filter((member) => member.status === 'ACTIVE'),
        );
        setSelectedId(
          (current) => current ?? conversationPayload[0]?.id ?? null,
        );
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Messagerie indisponible.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/chat/uploads/config', { signal: controller.signal })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { maxUploadBytes: number })
          : null,
      )
      .then((payload) => {
        if (payload) setMaxUploadBytes(payload.maxUploadBytes);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/v1/conversations/${selectedId}/messages`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Impossible de charger les messages.');
        return (await response.json()) as ChatMessage[];
      })
      .then((payload) => {
        setMessages(payload);
        setConversations((current) =>
          current.map((item) =>
            item.id === selectedId ? { ...item, unreadCount: 0 } : item,
          ),
        );
        return fetch(`/api/v1/conversations/${selectedId}/read`, {
          method: 'PATCH',
          headers: { 'x-csrf-token': csrfToken },
        });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Conversation indisponible.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setMessagesLoading(false);
      });
    return () => controller.abort();
  }, [csrfToken, selectedId]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let delay = 1_000;
    function connect() {
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
      );
      socket.onopen = () => {
        delay = 1_000;
      };
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data as string) as ChatRealtimeEvent;
        if (payload.type === 'chat.conversation') {
          setConversations((current) => [
            payload.conversation,
            ...current.filter((item) => item.id !== payload.conversation.id),
          ]);
        } else {
          if (payload.conversationId === selectedId) {
            setMessages((current) =>
              [
                ...current.filter((item) => item.id !== payload.message.id),
                payload.message,
              ].sort((left, right) =>
                left.createdAt.localeCompare(right.createdAt),
              ),
            );
            void fetch(`/api/v1/conversations/${payload.conversationId}/read`, {
              method: 'PATCH',
              headers: { 'x-csrf-token': csrfToken },
            });
          }
          void loadConversations();
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15_000);
      };
    }
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [csrfToken, loadConversations, selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || (!body.trim() && !selectedFiles.length) || sending)
      return;
    setSending(true);
    setError('');
    try {
      const attachmentIds = await Promise.all(
        selectedFiles.map(async (file, index) => {
          setUploadingLabel(`Envoi de ${index + 1}/${selectedFiles.length}…`);
          const initialized = await fetch('/api/v1/chat/uploads/init', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type || 'application/octet-stream',
              size: file.size,
              clientMutationId: crypto.randomUUID(),
            }),
          });
          if (!initialized.ok)
            throw new Error(`Impossible de préparer « ${file.name} ».`);
          const { uploadId } = (await initialized.json()) as {
            uploadId: string;
          };
          const uploaded = await fetch(
            `/api/v1/chat/uploads/${uploadId}/content`,
            {
              method: 'PUT',
              headers: {
                'content-type': 'application/octet-stream',
                'x-csrf-token': csrfToken,
              },
              body: file,
            },
          );
          if (!uploaded.ok)
            throw new Error(`Le format de « ${file.name} » est refusé.`);
          const completed = await fetch(
            `/api/v1/chat/uploads/${uploadId}/complete`,
            {
              method: 'POST',
              headers: { 'x-csrf-token': csrfToken },
            },
          );
          if (!completed.ok)
            throw new Error(`Impossible de finaliser « ${file.name} ».`);
          return uploadId;
        }),
      );
      setUploadingLabel('Envoi du message…');
      const response = await fetch(
        `/api/v1/conversations/${selectedId}/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            body: body.trim(),
            replyToId: replyTo?.id ?? null,
            attachmentIds,
            clientMutationId: crypto.randomUUID(),
          }),
        },
      );
      if (!response.ok) throw new Error('Le message n’a pas pu être envoyé.');
      const message = (await response.json()) as ChatMessage;
      setMessages((current) => [
        ...current.filter((item) => item.id !== message.id),
        message,
      ]);
      setBody('');
      setReplyTo(null);
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      void loadConversations();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Envoi impossible.');
    } finally {
      setSending(false);
      setUploadingLabel('');
    }
  }

  function selectFiles(files: FileList | null) {
    if (!files) return;
    if (selectedFiles.length + files.length > 8) {
      setError('Vous pouvez joindre au maximum 8 fichiers par message.');
      return;
    }
    const next = [...selectedFiles, ...Array.from(files)].slice(0, 8);
    const oversized = next.find((file) => file.size > maxUploadBytes);
    if (oversized) {
      setError(
        `« ${oversized.name} » dépasse la limite de ${formatFileSize(maxUploadBytes)}.`,
      );
      return;
    }
    setSelectedFiles(next);
    setError('');
  }

  async function toggleReaction(messageId: string, emoji: ChatReaction) {
    const response = await fetch(`/api/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ emoji }),
    });
    if (!response.ok) {
      setError('La réaction n’a pas pu être enregistrée.');
      return;
    }
    const message = (await response.json()) as ChatMessage;
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? message : item)),
    );
  }

  return (
    <>
      <ConversationDialog
        open={composerOpen}
        onOpenChange={onComposerOpenChange}
        currentMemberId={currentMemberId}
        members={members}
        csrfToken={csrfToken}
        onCreated={(conversation) => {
          setConversations((current) => [
            conversation,
            ...current.filter((item) => item.id !== conversation.id),
          ]);
          setSelectedId(conversation.id);
        }}
      />

      <section>
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-sm font-medium text-[#087f72]">
              Entre nous
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Messages
            </h1>
          </div>
          <Button
            onClick={() => onComposerOpenChange(true)}
            className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
          >
            <Plus data-icon="inline-start" aria-hidden="true" /> Nouvelle
            conversation
          </Button>
        </div>
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}
        <Card className="h-[calc(100dvh-14rem)] min-h-[480px] overflow-hidden py-0">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />{' '}
              Chargement de la messagerie…
            </div>
          ) : (
            <div className="grid h-full md:grid-cols-[300px_minmax(0,1fr)]">
              <aside
                className={`${selected ? 'hidden md:block' : 'block'} overflow-y-auto border-r`}
                aria-label="Conversations"
              >
                {conversations.length ? (
                  conversations.map((conversation) => (
                    <button
                      type="button"
                      key={conversation.id}
                      onClick={() => setSelectedId(conversation.id)}
                      className={`flex w-full gap-3 border-b p-4 text-left transition-colors hover:bg-muted/45 ${selectedId === conversation.id ? 'bg-[#e7f5f2]/65' : ''}`}
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold">
                        {conversation.displayTitle.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">
                            {conversation.displayTitle}
                          </span>
                          {conversation.unreadCount ? (
                            <Badge className="bg-[#087f72]">
                              {conversation.unreadCount}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {conversation.lastMessage ??
                            'Commencez la conversation'}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
                    <div>
                      <MessageCircle
                        className="mx-auto mb-3"
                        aria-hidden="true"
                      />
                      Aucune conversation.
                      <br />
                      Écrivez le premier message du foyer.
                    </div>
                  </div>
                )}
              </aside>
              {selected ? (
                <div className="flex min-h-0 flex-col">
                  <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="md:hidden"
                      aria-label="Retour aux conversations"
                      onClick={() => setSelectedId(null)}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </Button>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">
                        {selected.displayTitle}
                      </h2>
                      <p className="truncate text-xs text-muted-foreground">
                        {selected.participants
                          .map((item) => item.memberName)
                          .join(', ')}
                      </p>
                    </div>
                  </header>
                  <div
                    className="min-h-0 flex-1 overflow-y-auto bg-muted/15 p-4"
                    aria-live="polite"
                  >
                    {messagesLoading ? (
                      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" />{' '}
                        Chargement…
                      </div>
                    ) : messages.length ? (
                      messages.map((message) => (
                        <MessageBubble
                          key={message.id}
                          message={message}
                          mine={message.authorId === currentMemberId}
                          currentMemberId={currentMemberId}
                          onReply={() => setReplyTo(message)}
                          onReaction={(emoji) =>
                            void toggleReaction(message.id, emoji)
                          }
                        />
                      ))
                    ) : (
                      <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
                        <div>
                          <MessageCircle className="mx-auto mb-3 size-8" />
                          Dites bonjour pour démarrer.
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                  <form
                    onSubmit={sendMessage}
                    className="shrink-0 border-t bg-background p-3"
                  >
                    {selectedFiles.length ? (
                      <AttachmentGroup className="mb-2">
                        {selectedFiles.map((file, index) => (
                          <Attachment
                            key={`${file.name}-${file.size}-${index}`}
                            size="sm"
                          >
                            <AttachmentMedia>
                              <FileText aria-hidden="true" />
                            </AttachmentMedia>
                            <AttachmentContent>
                              <AttachmentTitle>{file.name}</AttachmentTitle>
                              <AttachmentDescription>
                                {formatFileSize(file.size)}
                              </AttachmentDescription>
                            </AttachmentContent>
                            <AttachmentActions>
                              <AttachmentAction
                                type="button"
                                aria-label={`Retirer ${file.name}`}
                                onClick={() =>
                                  setSelectedFiles((current) =>
                                    current.filter(
                                      (_, itemIndex) => itemIndex !== index,
                                    ),
                                  )
                                }
                              >
                                <X aria-hidden="true" />
                              </AttachmentAction>
                            </AttachmentActions>
                          </Attachment>
                        ))}
                      </AttachmentGroup>
                    ) : null}
                    {replyTo ? (
                      <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
                        <CornerUpLeft className="size-3" />
                        <span className="min-w-0 flex-1 truncate">
                          Réponse à {replyTo.authorName} : {replyTo.body}
                        </span>
                        <button
                          type="button"
                          aria-label="Annuler la réponse"
                          onClick={() => setReplyTo(null)}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : null}
                    <div className="flex items-end gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="sr-only"
                        id="chat-attachments"
                        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv,application/json,.zip,.docx,.xlsx,.pptx"
                        onChange={(event) => selectFiles(event.target.files)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={sending || selectedFiles.length >= 8}
                        aria-label="Ajouter des fichiers"
                        onClick={() => fileInputRef.current?.click()}
                        className="shrink-0"
                      >
                        <Paperclip aria-hidden="true" />
                      </Button>
                      <Textarea
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                        rows={1}
                        maxLength={4000}
                        aria-label="Votre message"
                        placeholder="Votre message…"
                        className="max-h-32 min-h-10 resize-none"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={
                          (!body.trim() && !selectedFiles.length) || sending
                        }
                        aria-label="Envoyer"
                        className="shrink-0 bg-[#087f72] hover:bg-[#076d63]"
                      >
                        {sending ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Send />
                        )}
                      </Button>
                    </div>
                    {uploadingLabel ? (
                      <output className="mt-1 block text-xs text-muted-foreground">
                        {uploadingLabel}
                      </output>
                    ) : null}
                  </form>
                </div>
              ) : (
                <div className="hidden place-items-center text-center text-muted-foreground md:grid">
                  <div>
                    <MessageCircle className="mx-auto mb-3 size-9" />
                    <p>Choisissez une conversation.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </section>
    </>
  );
}

function MessageBubble({
  message,
  mine,
  currentMemberId,
  onReply,
  onReaction,
}: {
  message: ChatMessage;
  mine: boolean;
  currentMemberId: string;
  onReply: () => void;
  onReaction: (emoji: ChatReaction) => void;
}) {
  return (
    <article
      className={`group mb-3 flex ${mine ? 'justify-end' : 'justify-start'}`}
    >
      <div className="max-w-[85%] sm:max-w-[72%]">
        {!mine ? (
          <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">
            {message.authorName}
          </p>
        ) : null}
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${mine ? 'rounded-br-md bg-[#087f72] text-white' : 'rounded-bl-md border bg-background'}`}
        >
          {message.replyTo ? (
            <div
              className={`mb-2 rounded-lg border-l-2 px-2 py-1 text-xs ${mine ? 'border-white/60 bg-white/10' : 'bg-muted'}`}
            >
              <strong>{message.replyTo.authorName}</strong>
              <span className="block truncate opacity-80">
                {message.replyTo.body}
              </span>
            </div>
          ) : null}
          {message.attachments.length ? (
            <MessageAttachments attachments={message.attachments} />
          ) : null}
          {message.body ? (
            <MessageText body={message.body} mine={mine} />
          ) : null}
          <time
            className={`mt-1 block text-right text-[10px] ${mine ? 'text-white/70' : 'text-muted-foreground'}`}
          >
            {new Intl.DateTimeFormat('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(message.createdAt))}
          </time>
        </div>
        <div
          className={`mt-1 flex flex-wrap items-center gap-1 ${mine ? 'justify-end' : ''}`}
        >
          {message.reactions.map((reaction) => (
            <button
              type="button"
              key={reaction.emoji}
              onClick={() => onReaction(reaction.emoji)}
              className={`rounded-full border px-2 py-0.5 text-xs ${reaction.memberIds.includes(currentMemberId) ? 'border-[#087f72] bg-[#e7f5f2]' : 'bg-background'}`}
              aria-label={`${reaction.emoji}, ${reaction.count} réaction${reaction.count > 1 ? 's' : ''}`}
            >
              {reaction.emoji} {reaction.count}
            </button>
          ))}
          <button
            type="button"
            onClick={onReply}
            className="rounded-full p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-muted group-hover:opacity-100"
            aria-label="Répondre"
          >
            <CornerUpLeft className="size-3.5" />
          </button>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-full px-1 text-xs text-muted-foreground">
              ＋
            </summary>
            <div className="absolute bottom-6 right-0 z-10 flex rounded-full border bg-background p-1 shadow-lg">
              {reactions.map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  onClick={() => onReaction(emoji)}
                  className="rounded-full p-1 hover:bg-muted"
                  aria-label={`Réagir avec ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

function MessageAttachments({
  attachments,
}: {
  attachments: ChatMessage['attachments'];
}) {
  return (
    <div className="mb-2 space-y-2">
      {attachments.map((attachment) =>
        attachment.kind === 'image' ? (
          <a
            key={attachment.id}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-xl bg-black/5"
            aria-label={`Ouvrir l’image ${attachment.filename}`}
          >
            {/* The authenticated attachment endpoint cannot be handled by a static image optimizer. */}
            {/* oxlint-disable-next-line next/no-img-element */}
            <img
              src={attachment.url}
              alt={attachment.filename}
              loading="lazy"
              className="max-h-72 w-full object-contain"
            />
            <span className="block truncate bg-black/25 px-2 py-1 text-xs text-white">
              {attachment.filename} · {formatFileSize(attachment.size)}
            </span>
          </a>
        ) : (
          <a
            key={attachment.id}
            href={attachment.url}
            className="block text-foreground no-underline"
            download={attachment.filename}
            aria-label={`Télécharger ${attachment.filename}`}
          >
            <Attachment className="w-full bg-background/95" size="sm">
              <AttachmentMedia>
                <FileText aria-hidden="true" />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{attachment.filename}</AttachmentTitle>
                <AttachmentDescription>
                  {formatFileSize(attachment.size)}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <Download className="size-4" aria-hidden="true" />
              </AttachmentActions>
            </Attachment>
          </a>
        ),
      )}
    </div>
  );
}

function MessageText({ body, mine }: { body: string; mine: boolean }) {
  const parts = body.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className={`underline underline-offset-2 ${mine ? 'text-white' : 'text-[#087f72]'}`}
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} o`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} Ko`;
  return `${(bytes / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

function ConversationDialog({
  open,
  onOpenChange,
  currentMemberId,
  members,
  csrfToken,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentMemberId: string;
  members: FamilyMember[];
  csrfToken: string;
  onCreated: (conversation: ConversationSummary) => void;
}) {
  const others = useMemo(
    () => members.filter((member) => member.id !== currentMemberId),
    [currentMemberId, members],
  );
  const [type, setType] = useState<ConversationType>('DIRECT');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected.length || (type === 'DIRECT' && selected.length !== 1))
      return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/v1/conversations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          type,
          title: type === 'DIRECT' ? null : title,
          participantIds: selected,
          clientMutationId: crypto.randomUUID(),
        }),
      });
      if (!response.ok)
        throw new Error('La conversation n’a pas pu être créée.');
      onCreated((await response.json()) as ConversationSummary);
      setTitle('');
      setSelected([]);
      onOpenChange(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Création impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvelle conversation</DialogTitle>
          <DialogDescription>
            Seuls les participants choisis pourront voir son contenu.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chat-type">Type</Label>
            <select
              id="chat-type"
              value={type}
              onChange={(event) => {
                const next = event.target.value as ConversationType;
                setType(next);
                if (next === 'DIRECT')
                  setSelected((current) => current.slice(0, 1));
              }}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="DIRECT">Discussion à deux</option>
              <option value="GROUP">Groupe</option>
              <option value="TOPIC">Sujet</option>
            </select>
          </div>
          {type !== 'DIRECT' ? (
            <div className="space-y-2">
              <Label htmlFor="chat-title">Titre</Label>
              <Input
                id="chat-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                required
                placeholder={
                  type === 'TOPIC' ? 'Vacances d’été' : 'Les cousins'
                }
              />
            </div>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Participants</legend>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border p-2">
              {others.map((member) => {
                const checked = selected.includes(member.id);
                return (
                  <label
                    key={member.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        setSelected((current) =>
                          value
                            ? type === 'DIRECT'
                              ? [member.id]
                              : [...current, member.id]
                            : current.filter((id) => id !== member.id),
                        )
                      }
                    />
                    <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold">
                      {member.firstName.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-sm">
                      {member.firstName}
                      {member.lastName ? ` ${member.lastName}` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full bg-[#087f72] hover:bg-[#076d63]"
            disabled={
              submitting ||
              !selected.length ||
              (type === 'DIRECT' && selected.length !== 1) ||
              (type !== 'DIRECT' && !title.trim())
            }
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : <Users />}{' '}
            Créer la conversation
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
