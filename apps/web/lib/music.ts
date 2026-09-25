export async function startSpotifyConnection(csrfToken: string) {
  const response = await fetch('/api/v1/music/spotify/connect', {
    method: 'POST', headers: { 'x-csrf-token': csrfToken },
  });
  if (!response.ok) throw new Error('La connexion à Spotify ne peut pas démarrer.');
  const payload = await response.json() as { authorizationUrl: string };
  window.location.assign(payload.authorizationUrl);
}
