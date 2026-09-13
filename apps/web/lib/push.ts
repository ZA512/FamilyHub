export function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
