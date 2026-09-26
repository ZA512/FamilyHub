import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, LoaderCircle, Music2, Play, RefreshCw, Search, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { localeTag } from '@/lib/i18n';
import { startSpotifyConnection } from '@/lib/music';

type Member = { id: string; firstName: string; shareEnabled: boolean };
type Artist = { id: string; name: string; url: string; imageUrl: string | null;
  memberIds: string[]; totalTracks: number; uniqueTracks: number; lastAddedAt: string; firstAddedAt: string;
  memberCounts: { memberId: string; count: number }[];
  memberFirstAddedAt: { memberId: string; addedAt: string }[] };
type Track = { id: string; name: string; uri: string; url: string; imageUrl: string | null;
  addedAt: string; memberIds: string[]; artistIds: string[] };
type MusicRecommendation = { id: string; kind: 'ARTIST' | 'TRACK'; senderName: string;
  targetId: string; targetName: string; spotifyUrl: string; spotifyUri: string | null;
  imageUrl: string | null; artistId: string | null; createdAt: string };
type Overview = { discoveries: Artist[]; common: Artist[]; recent: Artist[];
  recommendations: MusicRecommendation[]; members: Member[]; activity: string[]; newForMembers: {
    artistId: string; artistName: string; memberId: string; memberName: string; addedAt: string;
  }[] };
type Mix = { weekStart: string; items: { id: string; name: string; uri: string; url: string;
  imageUrl: string | null; sourceMemberId: string; sourceMemberName: string }[] };
type Detail = { artist: Artist; tracks: Track[]; members: Member[] };
type MemberDetail = { member: { id: string; firstName: string }; discoveries: Artist[];
  common: Artist[]; members: Member[] };
type MusicPath = { tab: 'overview' | 'artists' | 'playlist'; artistId?: string; memberId?: string };
type SpotifyStatus = { configured: boolean; connection: { lastSuccessfulSyncAt: string | null;
  syncing: boolean; shareEnabled: boolean; syncError: string | null } | null };
type RecommendationRecipient = { id: string; firstName: string };
type RecommendationTarget = { targetType: 'ARTIST' | 'TRACK'; targetId: string; name: string };

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase(localeTag());
}

function readPath(): MusicPath {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'music') return { tab: 'overview' };
  if (parts[1] === 'artists') return { tab: 'artists', artistId: parts[2] };
  if (parts[1] === 'members') return { tab: 'overview', memberId: parts[2] };
  if (parts[1] === 'playlist') return { tab: 'playlist' };
  return { tab: 'overview' };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Les données musicales ne sont pas disponibles.');
  return await response.json() as T;
}

function ArtistArtwork({ artist }: { artist: Artist }) {
  return artist.imageUrl ?
    // Spotify artwork is served from Spotify's CDN; this Vite app has no image optimizer.
    // oxlint-disable-next-line next/no-img-element
    <img src={artist.imageUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" /> :
    <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-accent text-primary"><Music2 /></span>;
}

export function MusicView({ csrfToken, onOpenSettings }: {
  csrfToken: string; onOpenSettings: () => void;
}) {
  const [path, setPath] = useState<MusicPath>(readPath);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [mix, setMix] = useState<Mix | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [recommendationRecipients, setRecommendationRecipients] = useState<RecommendationRecipient[]>([]);
  const [recommendationTarget, setRecommendationTarget] = useState<RecommendationTarget | null>(null);
  const [connected, setConnected] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [retryPlayback, setRetryPlayback] = useState<{ uris: string[]; fallbackUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [artistFilter, setArtistFilter] = useState<'all' | 'common' | 'new'>('all');
  const [artistQuery, setArtistQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState('all');
  const [sort, setSort] = useState<'relevance' | 'recent' | 'az'>('relevance');
  const [filterNow] = useState(() => Date.now());

  function go(url: string) {
    window.history.pushState({}, '', url);
    setLoading(true);
    setError('');
    setPath(readPath());
  }

  useEffect(() => {
    const onPop = () => { setLoading(true); setError(''); setPath(readPath()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackStatus = params.get('spotify');
    if (callbackStatus) {
      queueMicrotask(() => setNotice(callbackStatus === 'connected' ? 'Spotify est connecté. La première synchronisation démarre.' :
        callbackStatus === 'cancelled' ? 'Connexion Spotify annulée.' :
          callbackStatus === 'account_in_use' ? 'Ce compte Spotify est déjà associé à un autre membre.' :
            'La connexion Spotify a échoué. Réessayez.'));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const endpoint = path.artistId ? `/api/v1/music/artists/${encodeURIComponent(path.artistId)}` :
      path.memberId ? `/api/v1/music/members/${encodeURIComponent(path.memberId)}` : null;
    void Promise.all([
      getJson<SpotifyStatus>('/api/v1/music/spotify/status'),
      getJson<{ members: RecommendationRecipient[] }>('/api/v1/music/recommendation-recipients'),
      path.tab === 'overview' && !path.memberId ? getJson<Overview>('/api/v1/music/overview') : Promise.resolve(null),
      path.tab === 'artists' && !path.artistId ? getJson<{ artists: Artist[]; members: Member[] }>('/api/v1/music/artists') : Promise.resolve(null),
      path.tab === 'playlist' ? getJson<Mix>('/api/v1/music/weekly-mix') : Promise.resolve(null),
      endpoint ? getJson<Detail | MemberDetail>(endpoint) : Promise.resolve(null),
    ]).then(([status, recipients, nextOverview, nextArtists, nextMix, nextDetail]) => {
      if (!active) return;
      setConfigured(status.configured);
      setConnected(Boolean(status.connection));
      setSharing(Boolean(status.connection?.shareEnabled));
      setLastSync(status.connection?.lastSuccessfulSyncAt ?? null);
      setSyncing(Boolean(status.connection?.syncing));
      setSyncError(status.connection?.syncError ?? null);
      setRecommendationRecipients(recipients.members);
      if (nextOverview) { setOverview(nextOverview); setMembers(nextOverview.members); }
      if (nextArtists) { setArtists(nextArtists.artists); setMembers(nextArtists.members); }
      if (nextMix) setMix(nextMix);
      if (path.artistId) setDetail(nextDetail as Detail);
      if (path.memberId) setMemberDetail(nextDetail as MemberDetail);
      setError('');
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Chargement impossible.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [path, reload]);

  useEffect(() => {
    if (!connected || !syncing) return;
    const timer = window.setInterval(() => {
      void getJson<SpotifyStatus>('/api/v1/music/spotify/status').then((status) => {
        if (!status.connection?.syncing) {
          setSyncing(false);
          setReload((value) => value + 1);
        }
      }).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [connected, syncing]);

  const visibleArtists = useMemo(() => {
    const query = normalizeSearch(artistQuery.trim());
    const list = artists.filter((artist) =>
      (artistFilter !== 'common' || artist.memberIds.length >= 2) &&
      (artistFilter !== 'new' || filterNow - Date.parse(artist.firstAddedAt) <= 14 * 86_400_000) &&
      (memberFilter === 'all' || artist.memberIds.includes(memberFilter)) &&
      (!query || normalizeSearch(artist.name).includes(query)));
    if (sort === 'recent') list.sort((a, b) => b.lastAddedAt.localeCompare(a.lastAddedAt));
    if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return list;
  }, [artists, artistFilter, artistQuery, memberFilter, sort, filterNow]);

  async function play(uris: string[], fallbackUrl?: string) {
    setBusy(true); setError(''); setNotice(''); setFallbackUrl(null); setRetryPlayback(null);
    try {
      const response = await fetch('/api/v1/music/spotify/play', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ uris }),
      });
      const result = await response.json() as { deviceName?: string; error?: string };
      if (!response.ok) {
        if (result.error === 'NO_ACTIVE_DEVICE') {
          setError('Aucun appareil Spotify actif. Ouvrez Spotify sur votre téléphone, ordinateur ou enceinte puis réessayez.');
          setRetryPlayback({ uris, fallbackUrl });
        } else if (result.error === 'SPOTIFY_FORBIDDEN') {
          setError('La lecture à distance nécessite Spotify Premium et les autorisations de lecture.');
        } else {
          setError('La lecture n’a pas pu démarrer. Réessayez dans Spotify.');
        }
        if (fallbackUrl) setFallbackUrl(fallbackUrl);
        return;
      }
      setNotice(`Lecture lancée sur « ${result.deviceName} ».`);
    } catch { setError('Spotify est momentanément indisponible.'); }
    finally { setBusy(false); }
  }

  function artistCard(artist: Artist, familyMembers = members) {
    const names = familyMembers.filter((item) => artist.memberIds.includes(item.id)).map((item) => item.firstName);
    return <div key={artist.id} className="flex w-full items-center gap-2 rounded-xl border bg-background p-2 transition-colors hover:bg-muted">
      <button type="button" onClick={() => go(`/music/artists/${artist.id}`)} className="flex min-w-0 flex-1 items-center gap-3 p-1 text-left">
        <ArtistArtwork artist={artist} />
        <span className="min-w-0 flex-1"><strong className="block truncate font-medium">{artist.name}</strong>
          <span className="block truncate text-sm text-muted-foreground">{names.join(' · ') || 'Artiste à découvrir'}</span>
          <span className="block text-xs text-muted-foreground">{artist.uniqueTracks} titre{artist.uniqueTracks > 1 ? 's' : ''} aimé{artist.uniqueTracks > 1 ? 's' : ''}</span>
        </span>
      </button>
      <a href={artist.url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${artist.name} dans Spotify`}
        className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-background"><ExternalLink className="size-4" /></a>
    </div>;
  }

  function trackRow(track: Track | Mix['items'][number], detailLine?: string, recommendable = false) {
    return <div key={`${track.id}:${detailLine ?? ''}`} className="flex items-center gap-3 border-b py-3 last:border-b-0">
      {track.imageUrl ?
        // oxlint-disable-next-line next/no-img-element
        <img src={track.imageUrl} alt="" className="size-11 rounded-lg object-cover" /> :
        <span className="grid size-11 place-items-center rounded-lg bg-accent"><Music2 className="size-4" /></span>}
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{track.name}</p>
        {detailLine ? <p className="text-xs text-muted-foreground">{detailLine}</p> : null}</div>
      <Button size="icon" variant="ghost" disabled={!connected || busy} aria-label={`Lire ${track.name}`}
        onClick={() => void play([track.uri], track.url)}><Play className="size-4" /></Button>
      {recommendable ? <Button size="icon" variant="ghost" aria-label={`Recommander ${track.name}`}
        onClick={() => setRecommendationTarget({ targetType: 'TRACK', targetId: track.id, name: track.name })}>
        <Send className="size-4" /></Button> : null}
      <a href={track.url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${track.name} dans Spotify`}
        className="grid size-9 place-items-center rounded-lg hover:bg-muted"><ExternalLink className="size-4" /></a>
    </div>;
  }

  function recommendationRow(recommendation: MusicRecommendation) {
    return <div key={recommendation.id} className="flex items-center gap-3 rounded-xl border bg-background p-3">
      {recommendation.imageUrl ?
        // Spotify artwork is served from Spotify's CDN; this Vite app has no image optimizer.
        // oxlint-disable-next-line next/no-img-element
        <img src={recommendation.imageUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> :
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent"><Music2 className="size-4" /></span>}
      {recommendation.kind === 'ARTIST' ? <button type="button" className="min-w-0 flex-1 text-left"
        onClick={() => go(`/music/artists/${recommendation.targetId}`)}>
        <strong className="block truncate font-medium">{recommendation.targetName}</strong>
        <span className="block text-xs text-muted-foreground">Artiste recommandé par {recommendation.senderName}</span>
      </button> : <div className="min-w-0 flex-1">
        <strong className="block truncate font-medium">{recommendation.targetName}</strong>
        <span className="block text-xs text-muted-foreground">Titre recommandé par {recommendation.senderName}</span>
      </div>}
      {recommendation.spotifyUri ? <Button size="icon" variant="ghost" disabled={!connected || busy}
        aria-label={`Lire ${recommendation.targetName}`}
        onClick={() => void play([recommendation.spotifyUri!], recommendation.spotifyUrl)}>
        <Play className="size-4" /></Button> : null}
      <a href={recommendation.spotifyUrl} target="_blank" rel="noopener noreferrer"
        aria-label={`Ouvrir ${recommendation.targetName} dans Spotify`}
        className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-muted"><ExternalLink className="size-4" /></a>
    </div>;
  }

  const formatWeek = (value: string) => {
    const start = new Date(`${value}T12:00:00Z`);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    const joiner = localeTag().startsWith('en') ? 'to' : 'au';
    return `${start.toLocaleDateString(localeTag(), { day: 'numeric', month: 'long' })} ${joiner} ${end.toLocaleDateString(localeTag(), { day: 'numeric', month: 'long' })}`;
  };

  return <section>
    <div className="mb-6"><p className="mb-1 text-sm font-medium text-primary">Notre espace</p>
      <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Musique</h1>
      <p className="mt-1 text-base text-muted-foreground">Découvrez ce qui plaît à la famille.</p>
      {lastSync ? <p className="mt-2 text-xs text-muted-foreground">Données Spotify synchronisées le {new Date(lastSync).toLocaleString(localeTag())}.</p> : null}
      {syncing ? <p className="mt-1 text-xs text-muted-foreground">Synchronisation Spotify en cours…</p> : null}
    </div>
    {notice ? <output className="mb-4 block rounded-xl border bg-accent px-4 py-3 text-sm text-accent-foreground">{notice}</output> : null}
    {connected && syncing && !lastSync ? <p className="mb-4 rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">Premier import de vos favoris Spotify en cours. Les artistes seront visibles après la synchronisation ; les découvertes nécessitent aussi les goûts d’autres membres.</p> : null}
    {connected && syncError ? <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm">
      <span className="flex-1">{syncError === 'SPOTIFY_FORBIDDEN' ? 'Spotify refuse l’accès. Vérifiez que ce compte figure dans les utilisateurs autorisés de l’application.' :
        syncError === 'SPOTIFY_REAUTHORIZE' || syncError === 'AUTHORIZATION_FAILED' ? 'L’autorisation Spotify a expiré. Reconnectez votre compte.' :
          syncError === 'SPOTIFY_RATE_LIMITED' || syncError === 'SPOTIFY_QUOTA_EXCEEDED' ? 'Limite Spotify atteinte. Réessayez plus tard.' :
            'La synchronisation Spotify a échoué. Réessayez depuis les paramètres.'}</span>
      <Button size="sm" variant="outline" onClick={onOpenSettings}>Gérer Spotify</Button>
    </div> : null}
    {connected && !syncing && !lastSync && !syncError ? <p className="mb-4 rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">Aucun import Spotify terminé. Vous pouvez lancer une synchronisation depuis les paramètres.</p> : null}
    {error ? <p role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}
    {retryPlayback ? <Button className="mb-4" variant="outline" disabled={busy} onClick={() => void play(retryPlayback.uris, retryPlayback.fallbackUrl)}><RefreshCw className="size-4" />Réessayer</Button> : null}
    {fallbackUrl ? <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="mb-4 inline-block text-sm font-medium text-primary underline">Ouvrir ce titre dans Spotify</a> : null}
    {!connected && configured ? <Card className="mb-6"><CardHeader><CardTitle>Découvrez les goûts musicaux de la famille</CardTitle>
      <CardDescription>Connectez Spotify pour retrouver vos artistes favoris et découvrir ceux des autres. Le partage reste désactivé jusqu’à votre choix.</CardDescription></CardHeader>
      <CardContent><Button onClick={() => void startSpotifyConnection(csrfToken).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Connexion impossible.'))}>Connecter Spotify</Button></CardContent></Card> : null}
    {!configured ? <p className="mb-6 rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">L’intégration Spotify doit être configurée par l’administrateur du serveur.</p> : null}
    {connected && !sharing ? <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border bg-muted/35 px-4 py-3 text-sm">
      <span className="flex-1 text-muted-foreground">Vos favoris sont privés. Vous pouvez activer le partage familial dans les paramètres.</span>
      <Button size="sm" variant="outline" onClick={onOpenSettings}>Gérer le partage</Button>
    </div> : null}

    <nav aria-label="Vues Musique" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {([{ id: 'overview', label: 'Vue d’ensemble', url: '/music' },
        { id: 'artists', label: 'Artistes', url: '/music/artists' },
        { id: 'playlist', label: 'Playlist', url: '/music/playlist' }] as const).map((tab) =>
        <button key={tab.id} type="button" onClick={() => go(tab.url)} aria-current={path.tab === tab.id ? 'page' : undefined}
          className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium ${path.tab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{tab.label}</button>)}
    </nav>

    {loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-muted-foreground"><LoaderCircle className="animate-spin" />Chargement…</div> : null}

    {!loading && path.artistId && detail ? <div>
      <Button variant="ghost" className="mb-4" onClick={() => go('/music/artists')}><ArrowLeft /> Artistes</Button>
      <Card className="mb-6"><CardContent className="flex flex-wrap items-center gap-5 pt-6"><ArtistArtwork artist={detail.artist} />
        <div className="flex-1"><h2 className="text-2xl font-semibold">{detail.artist.name}</h2>
          <p className="text-sm text-muted-foreground">{detail.artist.uniqueTracks} titre{detail.artist.uniqueTracks > 1 ? 's' : ''} aimé{detail.artist.uniqueTracks > 1 ? 's' : ''} dans la famille</p></div>
        <Button variant="outline" onClick={() => setRecommendationTarget({
          targetType: 'ARTIST', targetId: detail.artist.id, name: detail.artist.name,
        })}><Send className="size-4" />Recommander</Button>
        <a href={detail.artist.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"><ExternalLink className="size-4" />Ouvrir dans Spotify</a>
      </CardContent></Card>
      <Card className="mb-6"><CardHeader><CardTitle>Dans la famille</CardTitle></CardHeader><CardContent className="space-y-2">
        {detail.artist.memberCounts.map((entry) => <button key={entry.memberId} type="button" onClick={() => go(`/music/members/${entry.memberId}`)}
          className="flex w-full justify-between rounded-lg p-2 text-left hover:bg-muted"><span>{detail.members.find((item) => item.id === entry.memberId)?.firstName}</span><span className="text-muted-foreground">{entry.count} titres</span></button>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Titres aimés dans la famille</CardTitle>
        <CardDescription>{detail.tracks.length < detail.artist.uniqueTracks ?
          `Les ${detail.tracks.length} titres les plus récemment aimés sur ${detail.artist.uniqueTracks}.` :
          'Chaque titre peut être écouté séparément ou ouvert directement dans Spotify.'}</CardDescription></CardHeader>
        <CardContent>{detail.tracks.map((track) => trackRow(track,
          `Aimé par ${detail.members.filter((item) => track.memberIds.includes(item.id)).map((item) => item.firstName).join(', ')}`, true))}
          {!detail.tracks.length ? <p className="text-sm text-muted-foreground">Aucun titre disponible pour cet artiste.</p> : null}</CardContent></Card>
    </div> : null}

    {!loading && path.memberId && memberDetail ? <div>
      <Button variant="ghost" className="mb-4" onClick={() => go('/music')}><ArrowLeft /> Vue d’ensemble</Button>
      <h2 className="mb-4 text-xl font-semibold">À découvrir chez {memberDetail.member.firstName}</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2">{memberDetail.discoveries.map((artist) => artistCard(artist, memberDetail.members))}
        {!memberDetail.discoveries.length ? <p className="text-muted-foreground">Aucune nouvelle découverte pour l’instant.</p> : null}</div>
      <h3 className="mb-4 text-lg font-semibold">Vous avez aussi en commun</h3>
      <div className="grid gap-3 sm:grid-cols-2">{memberDetail.common.map((artist) => artistCard(artist, memberDetail.members))}</div>
    </div> : null}

    {!loading && path.tab === 'overview' && !path.memberId && overview ? <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-6">
        {overview.recommendations.length ? <Card><CardHeader><CardTitle>Recommandé pour toi</CardTitle>
          <CardDescription>Les recommandations reçues restent visibles pendant 30 jours.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">{overview.recommendations.map(recommendationRow)}</CardContent></Card> : null}
        <Card><CardHeader><CardTitle>À découvrir pour toi</CardTitle><CardDescription>Des artistes enregistrés par les autres, absents de tes favoris.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">{overview.discoveries.map((artist) => artistCard(artist, overview.members))}
            {!overview.discoveries.length ? <p className="text-sm text-muted-foreground">Dès qu’un autre membre partagera ses goûts, les découvertes apparaîtront ici.</p> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle>En commun</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
          {overview.common.map((artist) => artistCard(artist, overview.members))}
          {!overview.common.length ? <p className="text-sm text-muted-foreground">Aucun artiste commun pour l’instant. Voilà justement quelques univers à explorer.</p> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle>Nouveaux dans la famille</CardTitle><CardDescription>Premiers titres enregistrés ces 14 derniers jours.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">{overview.recent.map((artist) => artistCard(artist, overview.members))}
            {!overview.recent.length ? <p className="text-sm text-muted-foreground">Rien de nouveau cette semaine.</p> : null}</CardContent></Card>
        {overview.newForMembers.length ? <Card><CardHeader><CardTitle>Nouveaux chez les membres</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">{overview.newForMembers.map((item) =>
            <button key={`${item.memberId}:${item.artistId}`} type="button" onClick={() => go(`/music/artists/${item.artistId}`)}
              className="block w-full rounded-lg p-2 text-left hover:bg-muted">{item.memberName} a enregistré ses premiers titres de {item.artistName}.</button>)}</CardContent></Card> : null}
        <Card><CardHeader><CardTitle>Playlist de la semaine</CardTitle><CardDescription>Générée automatiquement chaque semaine à partir des favoris partagés, jusqu’à deux titres par membre.</CardDescription></CardHeader>
          <CardContent><Button variant="outline" onClick={() => go('/music/playlist')}>Voir la sélection</Button></CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Ça bouge</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground">
        {overview.activity.length ? overview.activity.map((item) => <p key={item}>{item}</p>) : <p>Rien de nouveau cette semaine.</p>}
      </CardContent></Card>
    </div> : null}

    {!loading && path.tab === 'artists' && !path.artistId ? <div>
      <div className="relative mb-3 max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={artistQuery} onChange={(event) => setArtistQuery(event.target.value)}
          placeholder="Rechercher un artiste" aria-label="Rechercher un artiste" className="pl-9" /></div>
      <div className="mb-5 flex flex-wrap gap-2">
        {([{ id: 'all', label: 'Tous' }, { id: 'common', label: 'En commun' }, { id: 'new', label: 'Nouveaux' }] as const).map((item) =>
          <Button key={item.id} size="sm" variant={artistFilter === item.id ? 'default' : 'outline'} onClick={() => setArtistFilter(item.id)}>{item.label}</Button>)}
        <NativeSelect aria-label="Filtrer par membre" value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} className="ml-auto w-auto">
          <option value="all">Tous les membres</option>{members.filter((item) => item.shareEnabled).map((item) => <option key={item.id} value={item.id}>{item.firstName}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Trier les artistes" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="w-auto">
          <option value="relevance">Pertinence familiale</option><option value="recent">Récents</option><option value="az">A → Z</option>
        </NativeSelect>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{visibleArtists.map((artist) => artistCard(artist))}</div>
      {!visibleArtists.length ? <p className="rounded-xl border p-6 text-sm text-muted-foreground">Aucun artiste pour ce filtre.</p> : null}
    </div> : null}

    {!loading && path.tab === 'playlist' ? <Card><CardHeader><CardTitle>Découvertes de la famille</CardTitle>
      <CardDescription>{mix ? `Semaine du ${formatWeek(mix.weekStart)}. ` : ''}Cette sélection est créée automatiquement à partir des titres aimés et partagés. Il n’y a rien à ajouter manuellement.</CardDescription></CardHeader>
      <CardContent><div className="mb-4 flex flex-wrap items-center gap-3">
        <Button disabled={!connected || !mix?.items.length || busy} onClick={() => mix && void play(mix.items.map((item) => item.uri), mix.items[0]?.url)}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Play />} Lire la sélection sur Spotify</Button>
        {mix?.items.length ? <span className="text-sm text-muted-foreground">{mix.items.length} titres · {new Set(mix.items.map((item) => item.sourceMemberId)).size} membres</span> : null}
      </div>
        {mix?.items.map((item) => trackRow(item, `Proposé par ${item.sourceMemberName}`, true))}
        {!mix?.items.length ? <p className="text-sm text-muted-foreground">La sélection apparaîtra lorsque des membres partageront leurs favoris.</p> : null}
      </CardContent></Card> : null}
    <RecommendationDialog target={recommendationTarget} recipients={recommendationRecipients}
      csrfToken={csrfToken} onClose={() => setRecommendationTarget(null)} onSent={(count) => {
        setRecommendationTarget(null);
        setNotice(`Recommandation envoyée à ${count} personne${count > 1 ? 's' : ''}.`);
      }} />
  </section>;
}

function RecommendationDialog({ target, recipients, csrfToken, onClose, onSent }: {
  target: RecommendationTarget | null; recipients: RecommendationRecipient[]; csrfToken: string;
  onClose: () => void; onSent: (count: number) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function close() { setSelected([]); setError(''); onClose(); }

  async function submit() {
    if (!target || !selected.length) return;
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/v1/music/recommendations', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ targetType: target.targetType, targetId: target.targetId,
          recipientIds: selected }),
      });
      if (!response.ok) throw new Error('La recommandation n’a pas pu être envoyée.');
      const payload = await response.json() as { count: number };
      setSelected([]); onSent(payload.count);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Envoi impossible.');
    } finally { setSubmitting(false); }
  }

  return <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !submitting) close(); }}>
    {target ? <DialogContent className="sm:max-w-md"><DialogHeader>
      <DialogTitle>Recommander {target.targetType === 'ARTIST' ? 'cet artiste' : 'ce titre'}</DialogTitle>
      <DialogDescription>Choisissez une ou plusieurs personnes pour « {target.name} ».</DialogDescription>
    </DialogHeader>
      {recipients.length ? <fieldset className="space-y-2"><div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-medium">Destinataires</legend>
        <Button type="button" variant="ghost" size="sm" onClick={() =>
          setSelected(selected.length === recipients.length ? [] : recipients.map((member) => member.id))}>
          {selected.length === recipients.length ? 'Tout effacer' : 'Tout sélectionner'}
        </Button></div>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border p-2">{recipients.map((member) => {
          const checked = selected.includes(member.id);
          return <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted">
            <Checkbox checked={checked} onCheckedChange={(value) => setSelected((current) =>
              value ? [...current, member.id] : current.filter((id) => id !== member.id))} />
            <span>{member.firstName}</span>
          </label>;
        })}</div>
      </fieldset> : <p className="rounded-xl border bg-muted/35 p-4 text-sm text-muted-foreground">
        Aucun autre membre actif n’est disponible dans le foyer.
      </p>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button type="button" variant="outline" disabled={submitting} onClick={close}>Annuler</Button>
        <Button type="button" disabled={!selected.length || submitting} onClick={() => void submit()}>
          {submitting ? <LoaderCircle className="animate-spin" /> : <Send />}
          Recommander{selected.length ? ` à ${selected.length}` : ''}
        </Button></DialogFooter>
    </DialogContent> : null}
  </Dialog>;
}
