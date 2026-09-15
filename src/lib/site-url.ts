// Normalização e validação da URL do site WordPress.
// Puro: string entra, string sai. Roda no servidor e no cliente.

export class InvalidSiteUrlError extends Error {}

/**
 * "  exemplo.com/ "                              -> "https://exemplo.com"
 * "http://a.com/wp-json/site-status/v1/plugins"  -> "http://a.com"
 * @throws {InvalidSiteUrlError}
 */
export function normalizeSiteUrl(raw: string): string {
  const input = String(raw ?? '').trim();
  if (!input) throw new InvalidSiteUrlError('Informe a URL do site.');

  // sem protocolo, assume https
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidSiteUrlError('URL inválida. Use algo como https://exemplo.com');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidSiteUrlError('Use uma URL http:// ou https://');
  }
  if (!url.hostname.includes('.')) {
    throw new InvalidSiteUrlError('Domínio inválido. Use algo como https://exemplo.com');
  }

  // Guarda só a origem: descarta path (inclusive se colaram o próprio endpoint), query e hash.
  return url.origin;
}

/** Rótulo curto: sem protocolo, sem barra final. */
export function displayUrl(siteUrl: string): string {
  return String(siteUrl).replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/**
 * Bloqueia alvos internos (loopback, faixas privadas, .local) para que a rota
 * de leitura não vire um scanner da rede onde o app está hospedado.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1).map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}
