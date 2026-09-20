// Junta o inventário cru do WordPress com as versões do wordpress.org.
// Puro: recebe as duas listas e devolve o tipo Plugin que a UI já consome.

import { isComparableVersion, isOutdated } from './version';
import type { Plugin, RawPlugin, RawTheme, Theme } from './types';

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

/**
 * @param raw saída de fetchThemes
 * @param latest mapa stylesheet -> versão publicada (null = fora do repositório)
 *
 * O slug de tema é o próprio `stylesheet`, sem escape hatch como o
 * `plugin_uri` de plugin: o stylesheet É o nome do diretório do tema, e é
 * exatamente esse nome que o wordpress.org usa para identificar o tema no
 * repositório. Não há caso análogo ao Hello Dolly aqui — não "simplifique"
 * isso adicionando uma resolução de slug alternativa.
 */
export function mergeThemeVersions(
  raw: RawTheme[],
  latest: Map<string, string | null>,
): Theme[] {
  return raw.map((theme) => {
    const installed = theme.version;
    const published = latest.get(theme.stylesheet) ?? null;

    // Mesma lógica de mergePluginVersions: duas incertezas diferentes (versão
    // instalada ilegível, ou tema fora do repositório oficial), mesmo
    // veredito honesto — 'unknown', nunca 'em dia' nem 'desatualizado'.
    const comparable = isComparableVersion(installed) && published !== null;
    const outdated = isOutdated(installed ?? '', published);

    return {
      stylesheet: theme.stylesheet,
      name: theme.name,
      // O placeholder de exibição entra só aqui, na fronteira de renderização.
      version: installed ?? '—',
      is_active: theme.is_active,
      has_update: outdated,
      new_version: outdated && published ? published : '',
      update_source: comparable ? 'wporg' : 'unknown',
    };
  });
}
