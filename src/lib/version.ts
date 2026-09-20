// Comparação de versões no estilo WordPress. Puro e testável.
//
// Existe porque /wp/v2/plugins devolve a versão instalada mas NÃO devolve se há
// atualização — esse dado mora no transient `update_plugins`, que o core não
// expõe por REST. Comparamos contra a versão publicada no wordpress.org.

/** Divide "1.2.3-beta1" em [1, 2, 3] + flag de pré-lançamento. */
function parse(version: string): { parts: number[]; pre: boolean } {
  const raw = String(version ?? '').trim();
  const pre = /-(?:alpha|beta|rc|dev)/i.test(raw);
  const parts = raw
    .split('-')[0]
    .split('.')
    .map((segment) => {
      const n = Number.parseInt(segment, 10);
      return Number.isNaN(n) ? 0 : n;
    });
  return { parts, pre };
}

/** -1 se a < b, 0 se iguais, 1 se a > b. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.parts.length, right.parts.length);

  for (let i = 0; i < length; i += 1) {
    const x = left.parts[i] ?? 0;
    const y = right.parts[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }

  // Mesmos números: pré-lançamento perde da versão final.
  if (left.pre && !right.pre) return -1;
  if (!left.pre && right.pre) return 1;
  return 0;
}

/**
 * @param installed versão lida do site
 * @param latest versão publicada no wordpress.org; `null` quando o plugin não
 *   está no repositório oficial — nesse caso NÃO afirmamos nada.
 */
export function isOutdated(installed: string, latest: string | null): boolean {
  if (!latest) return false;
  return compareVersions(installed, latest) === -1;
}
