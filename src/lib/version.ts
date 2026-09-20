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

/**
 * -1 se a < b, 0 se iguais, 1 se a > b.
 *
 * Comportamentos não óbvios:
 * - Segmento não numérico é coagido para 0 — `'1.0.x'` compara IGUAL a
 *   `'1.0.0'`. Quem precisa distinguir "não deu pra ler" de "é zero mesmo"
 *   deve checar `isComparableVersion` antes de chamar esta função.
 * - Toda tag de pré-lançamento (alpha/beta/rc/dev) empata com qualquer
 *   outra tag de pré-lançamento nos mesmos números — só pré-lançamento vs.
 *   final é ordenado (`'1.0.0-beta1'` vs `'1.0.0-alpha1'` é `0`). Aceitável
 *   aqui porque o lado publicado (wordpress.org) é, na prática, sempre uma
 *   versão final.
 */
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
 * Uma versão é comparável quando tem ao menos um dígito na parte numérica.
 * '3.21.5' e '1.0.x' são comparáveis; 'invalid', 'N/A', '—' e '' não são.
 *
 * Existe porque `parse()` coage segmento ilegível para 0, e 0 compara como
 * mais antigo que quase tudo — o que transformaria "não sei qual a versão"
 * em "está desatualizado". Aqui a incerteza é detectada antes de virar
 * afirmação.
 */
export function isComparableVersion(version: string | null | undefined): boolean {
  if (!version) return false;
  return /\d/.test(version.split('-')[0]);
}

/**
 * @param installed versão lida do site
 * @param latest versão publicada no wordpress.org; `null` quando o plugin não
 *   está no repositório oficial — nesse caso NÃO afirmamos nada.
 *
 * Recusa-se a afirmar desatualização em dois casos: quando `latest` é
 * desconhecido (acima) e quando `installed` não é uma versão legível
 * (ex.: 'invalid', 'N/A', '—') — ver `isComparableVersion`.
 */
export function isOutdated(installed: string, latest: string | null): boolean {
  if (!latest) return false;
  if (!isComparableVersion(installed)) return false;
  return compareVersions(installed, latest) === -1;
}
