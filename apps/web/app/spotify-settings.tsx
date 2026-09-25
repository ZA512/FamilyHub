import { useEffect, useState } from 'react';
import { LoaderCircle, Music2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { localeTag } from '@/lib/i18n';
import { startSpotifyConnection } from '@/lib/music';

type Status = { configured: boolean; connection: null | {
  displayName: string | null; shareEnabled: boolean; connectedAt: string;
  lastSyncAt: string | null; lastSuccessfulSyncAt: string | null;
  syncing: boolean; syncError: string | null;
} };

export function SpotifySettings({ csrfToken }: { csrfToken: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const retryAt = status?.connection?.lastSyncAt ? Date.parse(status.connection.lastSyncAt) + 15 * 60_000 : 0;
  const coolingDown = retryAt > now;

  async function load() {
    const response = await fetch('/api/v1/music/spotify/status');
    if (!response.ok) throw new Error('État Spotify indisponible.');
    const payload = await response.json() as Status;
    setStatus(payload);
    setNow(Date.now());
    return payload;
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/music/spotify/status', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('État Spotify indisponible.');
        return await response.json() as Status;
      })
      .then((payload) => { if (!controller.signal.aborted) setStatus(payload); })
      .catch(() => { if (!controller.signal.aborted) setError('État Spotify indisponible.'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!status?.connection?.syncing) return;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 15_000);
    return () => window.clearInterval(timer);
  }, [status?.connection?.syncing]);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setTimeout(() => setNow(Date.now()), retryAt - now + 1_000);
    return () => window.clearTimeout(timer);
  }, [coolingDown, retryAt, now]);

  async function mutate(url: string, method: 'POST' | 'PATCH', body?: unknown) {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(url, { method,
        headers: { 'x-csrf-token': csrfToken, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (payload.error === 'SYNC_COOLDOWN') {
          const current = await load().catch(() => null);
          if (current?.connection?.syncing) throw new Error('Une synchronisation est déjà en cours.');
          if (current?.connection?.lastSyncAt) {
            const next = new Date(Date.parse(current.connection.lastSyncAt) + 15 * 60_000);
            throw new Error(`Synchronisation lancée récemment. Réessayez après ${next.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' })}.`);
          }
          throw new Error('Une synchronisation est déjà en cours ou a été lancée récemment.');
        }
        throw new Error(
          payload.error === 'SPOTIFY_RATE_LIMITED' || payload.error === 'SPOTIFY_QUOTA_EXCEEDED' ?
            'Limite Spotify atteinte. Réessayez plus tard.' :
            'Cette action Spotify a échoué. Réessayez plus tard.');
      }
      await load();
      setMessage(method === 'PATCH' ? 'Préférence de partage enregistrée.' :
        url.endsWith('/sync') ? 'Favoris synchronisés.' : 'Spotify déconnecté.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action impossible.');
    } finally { setBusy(false); }
  }

  return <Card className="mb-8"><CardHeader className="flex-row items-start gap-4">
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><Music2 className="size-5" /></span>
    <div><CardTitle className="text-base">Intégrations · Spotify</CardTitle>
      <CardDescription className="mt-1">FamilyHub utilise les morceaux enregistrés dans votre bibliothèque pour révéler les artistes appréciés par la famille. Votre historique d’écoute et votre activité en temps réel ne sont pas importés.</CardDescription></div>
  </CardHeader><CardContent className="space-y-4">
    {!status ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Chargement…</p> :
      !status.configured ? <p className="text-sm text-muted-foreground">L’administrateur du serveur doit configurer les identifiants Spotify.</p> :
        !status.connection ? <Button disabled={busy} onClick={() => {
          setBusy(true); void startSpotifyConnection(csrfToken).catch(() => {
            setError('La connexion Spotify ne peut pas démarrer.'); setBusy(false);
          });
        }}>Connecter Spotify</Button> : <>
          <p className="text-sm">Connecté en tant que <strong>{status.connection.displayName || 'compte Spotify'}</strong></p>
          <p className="text-xs text-muted-foreground">Dernière synchronisation réussie : {status.connection.lastSuccessfulSyncAt ?
            new Date(status.connection.lastSuccessfulSyncAt).toLocaleString(localeTag()) : 'en attente'}</p>
          {status.connection.syncing ? <p className="text-xs text-muted-foreground">Synchronisation en cours…</p> : null}
          {status.connection.syncError ? <p className="text-xs text-destructive">{
            status.connection.syncError === 'SPOTIFY_FORBIDDEN' ?
              'Spotify refuse l’accès. Vérifiez les autorisations et l’allowlist de l’application.' :
              status.connection.syncError === 'SPOTIFY_REAUTHORIZE' || status.connection.syncError === 'AUTHORIZATION_FAILED' ?
                'L’autorisation Spotify a expiré. Reconnectez votre compte.' :
                status.connection.syncError === 'SPOTIFY_RATE_LIMITED' || status.connection.syncError === 'SPOTIFY_QUOTA_EXCEEDED' ?
                  'Limite Spotify atteinte. Les données précédentes restent disponibles.' :
                  'La dernière synchronisation a échoué. Les données précédentes restent disponibles.'
          }</p> : null}
          <div className="flex items-center gap-3 rounded-xl border p-3 text-sm">
            <Switch id="spotify-share" checked={status.connection.shareEnabled} disabled={busy} onCheckedChange={(checked) =>
              void mutate('/api/v1/music/settings', 'PATCH', { shareEnabled: checked })} />
            <label htmlFor="spotify-share">Partager mes goûts musicaux avec la famille</label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || status.connection.syncing || coolingDown} onClick={() => void mutate('/api/v1/music/spotify/sync', 'POST')}>
              <RefreshCw className="size-4" />Synchroniser maintenant</Button>
            {coolingDown && !status.connection.syncing ? <p className="self-center text-xs text-muted-foreground">Nouvelle synchronisation possible à {new Date(retryAt).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' })}.</p> : null}
            {['SPOTIFY_REAUTHORIZE', 'AUTHORIZATION_FAILED'].includes(status.connection.syncError ?? '') ?
              <Button variant="outline" disabled={busy} onClick={() => {
                setBusy(true); void startSpotifyConnection(csrfToken).catch(() => {
                  setError('La connexion Spotify ne peut pas démarrer.'); setBusy(false);
                });
              }}>Reconnecter Spotify</Button> : null}
            <Button variant="outline" disabled={busy} onClick={() => void mutate('/api/v1/music/spotify/disconnect', 'POST')}>Déconnecter Spotify</Button>
          </div>
        </>}
    {message ? <output className="block text-sm text-primary">{message}</output> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </CardContent></Card>;
}
