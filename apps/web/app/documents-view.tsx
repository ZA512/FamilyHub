import { useEffect, useState, type SyntheticEvent } from 'react';
import { formatBinarySize, localeTag, t } from '@/lib/i18n';
import {
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Globe2,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';

import type {
  DocumentVisibility,
  FamilyDocument,
  FamilyGroup,
  FamilyMember,
} from '@familyhub/contracts';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type DocumentScope = 'all' | 'mine' | 'shared';

type DocumentsViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

const visibilityLabels: Record<DocumentVisibility, string> = {
  PRIVATE: 'Moi uniquement',
  ALL_MEMBERS: 'Tout le foyer',
  GROUPS: 'Certains groupes',
  SELECTED_USERS: 'Certaines personnes',
};

const acceptedFiles =
  'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv,application/json,.zip,.docx,.xlsx,.pptx';

function toggleValue(current: string[], id: string) {
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
}

export function DocumentsView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: DocumentsViewProps) {
  const [documents, setDocuments] = useState<FamilyDocument[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [scope, setScope] = useState<DocumentScope>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLabel, setUploadingLabel] = useState('');
  const [maxUploadBytes, setMaxUploadBytes] = useState(25 * 1024 * 1024);
  const [editing, setEditing] = useState<FamilyDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FamilyDocument | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [visibility, setVisibility] =
    useState<DocumentVisibility>('ALL_MEMBERS');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/members', { signal: controller.signal }),
      fetch('/api/v1/groups', { signal: controller.signal }),
      fetch('/api/v1/uploads/config', { signal: controller.signal }),
    ])
      .then(async ([membersResponse, groupsResponse, configResponse]) => {
        if (!membersResponse.ok || !groupsResponse.ok || !configResponse.ok) {
          throw new Error('Les options du module sont indisponibles.');
        }
        return Promise.all([
          membersResponse.json() as Promise<{ members: FamilyMember[] }>,
          groupsResponse.json() as Promise<{ groups: FamilyGroup[] }>,
          configResponse.json() as Promise<{ maxUploadBytes: number }>,
        ]);
      })
      .then(([memberPayload, groupPayload, configPayload]) => {
        setMembers(
          memberPayload.members.filter(
            (member) =>
              member.status === 'ACTIVE' && member.id !== currentMemberId,
          ),
        );
        setGroups(groupPayload.groups);
        setMaxUploadBytes(configPayload.maxUploadBytes);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error ? reason.message : 'Module indisponible.',
          );
        }
      });
    return () => controller.abort();
  }, [currentMemberId]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      const params = queryParams(scope, query, category, tag);
      fetch(`/api/v1/documents?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error('Impossible de charger les documents.');
          }
          return (await response.json()) as {
            documents: FamilyDocument[];
            hasMore: boolean;
          };
        })
        .then((payload) => {
          setDocuments(payload.documents);
          setHasMore(payload.hasMore);
          setError('');
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              reason instanceof Error
                ? reason.message
                : 'Documents indisponibles.',
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [category, query, reloadToken, scope, tag]);

  function resetEditor() {
    setEditing(null);
    setSelectedFile(null);
    setVisibility('ALL_MEMBERS');
    setSelectedGroups([]);
    setSelectedMembers([]);
    setUploadingLabel('');
  }

  function openCreate() {
    resetEditor();
    setError('');
    onComposerOpenChange(true);
  }

  function openEdit(document: FamilyDocument) {
    setEditing(document);
    setSelectedFile(null);
    setVisibility(document.visibility);
    setSelectedGroups(document.groupIds);
    setSelectedMembers(document.memberIds);
    setError('');
    onComposerOpenChange(true);
  }

  function closeEditor() {
    if (submitting) return;
    resetEditor();
    onComposerOpenChange(false);
  }

  async function uploadFile(file: File) {
    setUploadingLabel('Préparation du fichier…');
    const initialized = await fetch('/api/v1/uploads/init', {
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
    if (initialized.status === 507)
      throw new Error('Le quota de stockage du foyer est atteint.');
    if (!initialized.ok) throw new Error('Le fichier n’a pas pu être préparé.');
    const { uploadId } = (await initialized.json()) as { uploadId: string };
    setUploadingLabel('Envoi du fichier…');
    const uploaded = await fetch(`/api/v1/uploads/${uploadId}/content`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-csrf-token': csrfToken,
      },
      body: file,
    });
    if (!uploaded.ok) throw new Error('Ce type de fichier est refusé.');
    const completed = await fetch(`/api/v1/uploads/${uploadId}/complete`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    });
    if (!completed.ok) throw new Error('Le fichier n’a pas pu être finalisé.');
    return uploadId;
  }

  async function saveDocument(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tagsValue = data.get('tags');
    if (!editing && !selectedFile) {
      setError('Choisissez un fichier à déposer.');
      return;
    }
    if (selectedFile && selectedFile.size > maxUploadBytes) {
      setError(
        `Le fichier dépasse la limite de ${formatFileSize(maxUploadBytes)}.`,
      );
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const attachmentId = editing ? null : await uploadFile(selectedFile!);
      setUploadingLabel('Enregistrement de la fiche…');
      const response = await fetch(
        editing ? `/api/v1/documents/${editing.id}` : '/api/v1/documents',
        {
          method: editing ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            title: data.get('title'),
            category: data.get('category'),
            comment: data.get('comment'),
            tags:
              typeof tagsValue === 'string'
                ? tagsValue
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            visibility,
            groupIds: selectedGroups,
            memberIds: selectedMembers,
            ...(editing
              ? { version: editing.version }
              : {
                  attachmentId,
                  clientMutationId: crypto.randomUUID(),
                }),
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (payload?.error === 'VERSION_CONFLICT') {
          throw new Error(
            'Ce document a été modifié ailleurs. Fermez puis rouvrez sa fiche.',
          );
        }
        throw new Error('Le document n’a pas pu être enregistré.');
      }
      resetEditor();
      onComposerOpenChange(false);
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
      setUploadingLabel('');
    }
  }

  async function removeDocument() {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/documents/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) {
        throw new Error('Le document n’a pas pu être supprimé.');
      }
      setDeleteTarget(null);
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMoreDocuments() {
    const last = documents.at(-1);
    if (!last) return;
    setLoadingMore(true);
    setError('');
    try {
      const params = queryParams(scope, query, category, tag);
      params.set('before', last.updatedAt);
      params.set('beforeId', last.id);
      const response = await fetch(`/api/v1/documents?${params}`);
      if (!response.ok) throw new Error('Impossible de charger la suite.');
      const payload = (await response.json()) as {
        documents: FamilyDocument[];
        hasMore: boolean;
      };
      setDocuments((current) => [...current, ...payload.documents]);
      setHasMore(payload.hasMore);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const availableCategories = [
    ...new Set(documents.map((document) => document.category)),
  ].sort((left, right) => left.localeCompare(right, localeTag()));
  const availableTags = [
    ...new Set(documents.flatMap((document) => document.tags)),
  ].sort((left, right) => left.localeCompare(right, localeTag()));

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-medium text-[#087f72]">
            Fichiers utiles
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
            Documents
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Les documents importants du foyer, sans classement compliqué.
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
        >
          <Plus /> Déposer un document
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

      <div className="mb-5 grid gap-3 xl:grid-cols-[auto_minmax(220px,1fr)_190px_190px]">
        <Tabs
          value={scope}
          onValueChange={(value) => setScope(value as DocumentScope)}
        >
          <TabsList>
            <TabsTrigger value="all">Tous</TabsTrigger>
            <TabsTrigger value="mine">Mes documents</TabsTrigger>
            <TabsTrigger value="shared">Partagés</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Titre, catégorie, fichier…"
            className="pl-9"
            aria-label="Rechercher un document"
          />
        </div>
        <Select
          value={category || 'ALL'}
          onValueChange={(value) =>
            setCategory(value === 'ALL' ? '' : (value ?? ''))
          }
        >
          <SelectTrigger aria-label="Filtrer par catégorie">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Toutes les catégories</SelectItem>
            {availableCategories.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={tag || 'ALL'}
          onValueChange={(value) =>
            setTag(value === 'ALL' ? '' : (value ?? ''))
          }
        >
          <SelectTrigger aria-label="Filtrer par tag">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous les tags</SelectItem>
            {availableTags.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <LoaderCircle className="animate-spin" /> Chargement des documents…
          </CardContent>
        </Card>
      ) : documents.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {documents.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onEdit={() => openEdit(document)}
              onDelete={() => setDeleteTarget(document)}
              onCategory={setCategory}
              onTag={setTag}
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
              <FileText />
            </span>
            <h2 className="font-semibold">Aucun document</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Déposez un contrat, une attestation ou tout autre fichier utile au
              foyer.
            </p>
            <Button onClick={openCreate} variant="outline" className="mt-5">
              <Upload /> Déposer le premier
            </Button>
          </CardContent>
        </Card>
      )}
      {hasMore ? (
        <div className="mt-5 text-center">
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void loadMoreDocuments()}
          >
            {loadingMore ? <LoaderCircle className="animate-spin" /> : null}
            Afficher plus
          </Button>
        </div>
      ) : null}

      <DocumentEditor
        key={editing?.id ?? `new-${composerOpen}`}
        open={composerOpen}
        document={editing}
        file={selectedFile}
        maxUploadBytes={maxUploadBytes}
        visibility={visibility}
        members={members}
        groups={groups}
        selectedGroups={selectedGroups}
        selectedMembers={selectedMembers}
        submitting={submitting}
        uploadingLabel={uploadingLabel}
        error={error}
        onFileChange={setSelectedFile}
        onClose={closeEditor}
        onSave={saveDocument}
        onVisibilityChange={setVisibility}
        onGroupsChange={setSelectedGroups}
        onMembersChange={setSelectedMembers}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.title} » ne sera plus accessible dans le foyer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => void removeDocument()}
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}{' '}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function DocumentCard({
  document,
  onEdit,
  onDelete,
  onCategory,
  onTag,
}: {
  document: FamilyDocument;
  onEdit: () => void;
  onDelete: () => void;
  onCategory: (value: string) => void;
  onTag: (value: string) => void;
}) {
  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
            <DocumentFileIcon contentType={document.attachment.contentType} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 font-semibold leading-snug">
              {document.title}
            </h2>
            <button
              type="button"
              onClick={() => onCategory(document.category)}
              className="mt-1 text-xs font-medium text-[#087f72] hover:underline"
            >
              {document.category}
            </button>
          </div>
          {document.editable ? (
            <div className="flex">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Modifier ${document.title}`}
                onClick={onEdit}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Supprimer ${document.title}`}
                onClick={onDelete}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
        <div className="mt-4 rounded-xl border bg-muted/25 p-3">
          <p className="truncate text-sm font-medium">
            {document.attachment.filename}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatFileSize(document.attachment.size)} · ajouté par{' '}
            {document.createdByName}
          </p>
        </div>
        {document.comment ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {document.comment}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {document.tags.map((value) => (
            <button key={value} type="button" onClick={() => onTag(value)}>
              <Badge variant="secondary">{value}</Badge>
            </button>
          ))}
          <VisibilityBadge visibility={document.visibility} />
        </div>
        <a
          href={document.attachment.url}
          download={document.attachment.filename}
          className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4 w-full`}
        >
          <Download /> Télécharger
        </a>
      </CardContent>
    </Card>
  );
}

function VisibilityBadge({ visibility }: { visibility: DocumentVisibility }) {
  const Icon =
    visibility === 'PRIVATE'
      ? Lock
      : visibility === 'ALL_MEMBERS'
        ? Globe2
        : Users;
  return (
    <Badge variant="outline" className="ml-auto">
      <Icon className="size-3" /> {visibilityLabels[visibility]}
    </Badge>
  );
}

function DocumentEditor({
  open,
  document,
  file,
  maxUploadBytes,
  visibility,
  members,
  groups,
  selectedGroups,
  selectedMembers,
  submitting,
  uploadingLabel,
  error,
  onFileChange,
  onClose,
  onSave,
  onVisibilityChange,
  onGroupsChange,
  onMembersChange,
}: {
  open: boolean;
  document: FamilyDocument | null;
  file: File | null;
  maxUploadBytes: number;
  visibility: DocumentVisibility;
  members: FamilyMember[];
  groups: FamilyGroup[];
  selectedGroups: string[];
  selectedMembers: string[];
  submitting: boolean;
  uploadingLabel: string;
  error: string;
  onFileChange: (file: File | null) => void;
  onClose: () => void;
  onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
  onVisibilityChange: (value: DocumentVisibility) => void;
  onGroupsChange: (value: string[]) => void;
  onMembersChange: (value: string[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {document ? 'Modifier le document' : 'Déposer un document'}
          </DialogTitle>
          <DialogDescription>
            Un fichier et quelques repères suffisent pour le retrouver
            facilement.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}
        <form onSubmit={onSave} className="space-y-5">
          {document ? (
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                {document.attachment.filename}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(document.attachment.size)} · le fichier
                d’origine est conservé
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="document-file">Fichier</Label>
              <Input
                id="document-file"
                type="file"
                required
                accept={acceptedFiles}
                onChange={(event) =>
                  onFileChange(event.target.files?.[0] ?? null)
                }
              />
              <p className="text-xs text-muted-foreground">
                PDF, images, texte, archives et documents bureautiques ·{' '}
                {formatFileSize(maxUploadBytes)} maximum
              </p>
              {file ? (
                <p className="text-sm font-medium">
                  {file.name} · {formatFileSize(file.size)}
                </p>
              ) : null}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="document-title">Titre</Label>
              <Input
                id="document-title"
                name="title"
                required
                maxLength={200}
                defaultValue={document?.title ?? ''}
                placeholder="Assurance habitation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-category">Catégorie</Label>
              <Input
                id="document-category"
                name="category"
                required
                maxLength={80}
                defaultValue={document?.category ?? ''}
                placeholder="Administration"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="document-comment">
              Commentaire{' '}
              <span className="font-normal text-muted-foreground">
                (facultatif)
              </span>
            </Label>
            <Textarea
              id="document-comment"
              name="comment"
              maxLength={2000}
              defaultValue={document?.comment ?? ''}
              placeholder="Informations utiles sur ce document…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="document-tags">
              Tags{' '}
              <span className="font-normal text-muted-foreground">
                (séparés par des virgules)
              </span>
            </Label>
            <Input
              id="document-tags"
              name="tags"
              maxLength={500}
              defaultValue={document?.tags.join(', ') ?? ''}
              placeholder="maison, assurance, 2026"
            />
          </div>
          <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
            <div className="space-y-2">
              <Label htmlFor="document-visibility">
                Qui peut voir ce document ?
              </Label>
              <Select
                value={visibility}
                onValueChange={(value) =>
                  onVisibilityChange(value as DocumentVisibility)
                }
              >
                <SelectTrigger id="document-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(visibilityLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {visibility === 'GROUPS' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {groups.map((group) => (
                  <label
                    key={group.id}
                    className="flex items-center gap-3 rounded-xl border bg-background p-3 text-sm"
                  >
                    <Checkbox
                      checked={selectedGroups.includes(group.id)}
                      onCheckedChange={() =>
                        onGroupsChange(toggleValue(selectedGroups, group.id))
                      }
                    />
                    {group.name}
                  </label>
                ))}
              </div>
            ) : null}
            {visibility === 'SELECTED_USERS' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {members.map((member) => (
                  <label
                    key={member.id}
                    className="flex items-center gap-3 rounded-xl border bg-background p-3 text-sm"
                  >
                    <Checkbox
                      checked={selectedMembers.includes(member.id)}
                      onCheckedChange={() =>
                        onMembersChange(toggleValue(selectedMembers, member.id))
                      }
                    />
                    {member.firstName} {member.lastName}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onClose}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-[#087f72] hover:bg-[#076d63]"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Upload />
              )}
              {uploadingLabel
                ? t(uploadingLabel)
                : document
                  ? 'Enregistrer'
                  : 'Déposer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function queryParams(
  scope: DocumentScope,
  query: string,
  category: string,
  tag: string,
) {
  const params = new URLSearchParams({ scope, limit: '50' });
  if (query.trim()) params.set('q', query.trim());
  if (category) params.set('category', category);
  if (tag) params.set('tag', tag);
  return params;
}

function DocumentFileIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith('image/')) return <FileImage className="size-5" />;
  if (contentType.includes('spreadsheet') || contentType === 'text/csv') {
    return <FileSpreadsheet className="size-5" />;
  }
  if (contentType.includes('zip')) return <FileArchive className="size-5" />;
  return <FileText className="size-5" />;
}

function formatFileSize(size: number) {
  return formatBinarySize(size);
}
