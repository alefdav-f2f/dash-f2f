// Junta o inventário cru do WordPress com as versões do wordpress.org.
// Puro: recebe as duas listas e devolve o tipo Plugin que a UI já consome.

import { isComparableVersion, isOutdated } from './version';
import type { Plugin, RawPlugin } from './types';

/**
 * @param raw saída de fetchRawPlugins
 * @param latest mapa slug -> versão publicada (null = fora do repositório)
 */
export function mergePluginVersions(
  raw: RawPlugin[],
  latest: Map<string, string | null>,
): Plugin[] {
  return raw.map((plugin) => {
    const installed = plugin.version;
    const published = latest.get(plugin.slug) ?? null;

    // Duas incertezas diferentes, mesmo veredito: versão instalada ilegível (o
    // site não informou, ou informou lixo) ou versão publicada ausente (plugin
    // fora do repositório oficial). Em nenhum dos dois casos dá para afirmar
    // nada — 'unknown' é honesto, 'em dia' seria mentira, e 'desatualizado'
    // seria pior ainda. `isComparableVersion` é o que separa "não sei" de zero.
    const comparable = isComparableVersion(installed) && published !== null;
    // isOutdated já recusa sozinho versão ilegível e publicada ausente, então
    // não precisa de guarda aqui nem de asserção de não-nulo.
    const outdated = isOutdated(installed ?? '', published);

    return {
      file: plugin.file,
      name: plugin.name,
      // O placeholder de exibição entra só aqui, na fronteira de renderização.
      version: installed ?? '—',
      is_active: plugin.is_active,
      has_update: outdated,
      new_version: outdated && published ? published : '',
      update_source: comparable ? 'wporg' : 'unknown',
    };
  });
}
