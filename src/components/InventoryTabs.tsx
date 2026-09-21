'use client';

// Abas do inventário. Plugins continua sendo a aba padrão — é o motivo do painel
// existir; o resto é contexto.
//
// Temas, usuários e configurações são best-effort (ver collectInventory em
// wp-rest.ts): um 403 em /wp/v2/users (falta a capability list_users) não pode
// derrubar a varredura inteira, mas também não pode virar uma aba vazia que
// parece um fato. `failures` é o que distingue "não tem" de "não conseguimos
// ler" — as duas coisas têm que parecer visualmente diferentes.

import { useState } from 'react';
import { PluginTable } from '@/components/PluginTable';
import type { FilterKey } from '@/lib/plugins';
import type { Change } from '@/lib/diff';
import type { ContentActivity, HealthCheck, HealthStatus, InventoryResource, Plugin, Theme, WpSettings, WpUser } from '@/lib/types';

type TabKey = 'plugins' | 'themes' | 'users' | 'settings' | 'health' | 'activity';

const TAB_LABEL: Record<TabKey, string> = {
  plugins: 'Plugins',
  themes: 'Temas',
  users: 'Usuários',
  settings: 'Configurações',
  health: 'Saúde',
  activity: 'Atividade',
};

type Props = {
  plugins: Plugin[];
  themes: Theme[];
  users: WpUser[];
  settings: WpSettings | null;
  health: HealthCheck[];
  content: ContentActivity[];
  failures: Partial<Record<InventoryResource, string>>;
  filter: FilterKey;
  onFilter: (key: FilterKey) => void;
  changes: Record<string, Change[]>;
};

/** Quantas checagens de saúde merecem os olhos de alguém: tudo que não é
 *  'good'. 'recommended' é ação sugerida, 'critical' é alarme, 'unknown' é
 *  "não sabemos" — nenhum dos três é "está tudo bem", então os três contam.
 *  Só 'good' fica de fora. */
function healthNeedsAttention(health: HealthCheck[]): boolean {
  return health.some((h) => h.status !== 'good');
}

/** Temas que merecem os olhos de alguém: atualização pendente, ou
 *  update_source 'unknown' — "não sabemos" também não é "está tudo bem". */
function themeNeedsAttention(themes: Theme[]): boolean {
  return themes.some((t) => t.has_update || t.update_source === 'unknown');
}

/** Mesma regra de themeNeedsAttention aplicada a plugins: atualização
 *  pendente, ou procedência da checagem de atualização desconhecida (plugin
 *  fora do wordpress.org, onde `has_update` não é confiável). */
function pluginNeedsAttention(plugins: Plugin[]): boolean {
  return plugins.some((p) => p.has_update || p.update_source === 'unknown');
}

/** Usuários: a única coisa que vale marcar aqui é "todo mundo é admin" — não
 *  "existe 1 admin" (papel normal em qualquer site) nem "existem usuários"
 *  (é o total, não atenção). Um site inteiro sem separação de papéis é o tipo
 *  de coisa que vale uma segunda olhada (superfície de conta comprometida =
 *  toda a base de usuários). Lista vazia não é "risco", é "nada para avaliar".
 */
function usersNeedAttention(users: WpUser[]): boolean {
  if (users.length === 0) return false;
  return users.every((u) => u.roles.split(',').map((r) => r.trim()).includes('administrator'));
}

export function InventoryTabs({ plugins, themes, users, settings, health, content, failures, filter, onFilter, changes }: Props) {
  const [tab, setTab] = useState<TabKey>('plugins');

  /**
   * Estado visual de um chip — Task 14b: uma convenção só de contagem para
   * as seis abas. O número, quando existe, é sempre o TOTAL da lista, nunca
   * quantos itens pedem atenção — "Temas · 5" é "existem 5 temas", do mesmo
   * jeito que "Plugins · 7" é "existem 7 plugins"; misturar os dois
   * significados no mesmo formato era o bug que esta task resolve. "Precisa
   * de atenção" vira um marcador separado (`.chip-attn`, um ponto âmbar — ver
   * globals.css), nunca um segundo número.
   *
   * Três estados, não dois: calmo (só o total), atenção (total + marcador),
   * e falhou (`.chip-fail`, vermelho — "não conseguimos ler", não "leu e tem
   * problema"). `failed` sempre vence `attention` na aparência: se a leitura
   * falhou não dá para saber se há algo para revisar, então não fingimos que
   * sabemos.
   *
   * Configurações continua sem contagem (é um singleton, não uma lista) e
   * sem marcador de atenção — só o falhou existente.
   */
  function chipState(key: TabKey): { label: string; failed: boolean; attention: boolean; attentionReason?: string } {
    switch (key) {
      case 'plugins': {
        // Plugins é obrigatório: se a leitura falhar, a varredura inteira
        // falha antes de chegar a esta tela — não há um `failures.plugins`.
        const attention = pluginNeedsAttention(plugins);
        return {
          label: `${TAB_LABEL.plugins} · ${plugins.length}`,
          failed: false,
          attention,
          attentionReason: attention ? 'Há plugins com atualização pendente ou de procedência desconhecida.' : undefined,
        };
      }
      case 'themes': {
        const failed = Boolean(failures.themes);
        const attention = !failed && themeNeedsAttention(themes);
        return {
          label: failed ? `${TAB_LABEL.themes} · falhou` : `${TAB_LABEL.themes} · ${themes.length}`,
          failed,
          attention,
          attentionReason: attention ? 'Há temas com atualização pendente ou de procedência desconhecida.' : undefined,
        };
      }
      case 'users': {
        const failed = Boolean(failures.users);
        const attention = !failed && usersNeedAttention(users);
        return {
          label: failed ? `${TAB_LABEL.users} · falhou` : `${TAB_LABEL.users} · ${users.length}`,
          failed,
          attention,
          attentionReason: attention ? 'Todos os usuários deste site são administradores.' : undefined,
        };
      }
      case 'settings': {
        const failed = Boolean(failures.settings);
        return { label: failed ? `${TAB_LABEL.settings} · falhou` : TAB_LABEL.settings, failed, attention: false };
      }
      case 'health': {
        const failed = Boolean(failures.health);
        const attention = !failed && healthNeedsAttention(health);
        return {
          label: failed ? `${TAB_LABEL.health} · falhou` : `${TAB_LABEL.health} · ${health.length}`,
          failed,
          attention,
          attentionReason: attention ? 'Há checagens de saúde fora do estado "Boa".' : undefined,
        };
      }
      case 'activity': {
        // Sem regra de atenção natural para um item de conteúdo (ver
        // comentário original da task 11/14) — permanece sempre calma.
        const failed = Boolean(failures.content);
        return {
          label: failed ? `${TAB_LABEL.activity} · falhou` : `${TAB_LABEL.activity} · ${content.length}`,
          failed,
          attention: false,
        };
      }
    }
  }

  return (
    <div className="inv">
      <div className="chips">
        {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => {
          const { label, failed, attention, attentionReason } = chipState(key);
          return (
            <button
              key={key}
              type="button"
              // Não desabilita a aba com falha: desabilitar esconderia a
              // explicação atrás de um controle inerte. A aba continua
              // clicável e mostra o motivo no lugar da tabela.
              className={`chip${key === tab ? ' on' : ''}${failed ? ' chip-fail' : ''}${attention ? ' chip-attn' : ''}`}
              aria-pressed={key === tab}
              // O marcador de atenção não pode depender só da cor do ponto:
              // `title` (tooltip do mouse) e `aria-label` (leitor de tela)
              // carregam a mesma explicação por texto.
              title={attentionReason}
              aria-label={attentionReason ? `${label}. ${attentionReason}` : undefined}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'plugins' && (
        <PluginTable plugins={plugins} filter={filter} onFilter={onFilter} changes={changes} />
      )}
      {tab === 'themes' && <ThemesPanel themes={themes} failure={failures.themes} />}
      {tab === 'users' && <UsersPanel users={users} failure={failures.users} />}
      {tab === 'settings' && <SettingsPanel settings={settings} failure={failures.settings} />}
      {tab === 'health' && <HealthPanel health={health} failure={failures.health} />}
      {tab === 'activity' && (
        <ActivityPanel content={content} users={users} settings={settings} failure={failures.content} />
      )}
    </div>
  );
}

/** "Não lemos" — nunca "não tem". Reaproveita o vocabulário visual de erro
 *  (`.err`, o mesmo painel de ErrorState) porque é isso que é: uma leitura
 *  que falhou, não um resultado vazio. */
function FailureNotice({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="err" role="alert">
      <b>{title}</b>
      <p>{reason}</p>
    </div>
  );
}

function ThemesPanel({ themes, failure }: { themes: Theme[]; failure?: string }) {
  if (failure) return <FailureNotice title="Não foi possível ler os temas" reason={failure} />;

  return (
    <div className="tablewrap">
      <div className="tbar">
        <span className="count">{themes.length} {themes.length === 1 ? 'tema' : 'temas'}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '36%' }}>Tema</th>
            <th style={{ width: '24%' }}>Stylesheet</th>
            <th style={{ width: '18%' }}>Versão</th>
            <th style={{ width: '22%' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {themes.length === 0 ? (
            <tr>
              <td colSpan={4} className="table-empty">Nenhum tema instalado neste site.</td>
            </tr>
          ) : (
            themes.map((t) => {
              const hasNew = t.has_update && Boolean(t.new_version);
              return (
                <tr key={t.stylesheet}>
                  <td data-col="tema"><div className="pname">{t.name}</div></td>
                  <td data-col="stylesheet"><span className="pfile mono">{t.stylesheet}</span></td>
                  <td data-col="versao">
                    <span className="ver">{t.version}</span>
                    {hasNew && <span className="new">{t.new_version}</span>}
                  </td>
                  <td data-col="status">
                    <span className={`badge ${t.is_active ? 'badge-active' : 'badge-inactive'}`}>
                      {t.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                    {t.update_source === 'unknown' && (
                      <span
                        className="badge badge-unknown"
                        title="Tema fora do repositório oficial do WordPress. Não temos como saber se há versão mais nova."
                      >
                        atualização desconhecida
                      </span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function UsersPanel({ users, failure }: { users: WpUser[]; failure?: string }) {
  if (failure) return <FailureNotice title="Não foi possível ler os usuários" reason={failure} />;

  return (
    <div className="tablewrap">
      <div className="tbar">
        <span className="count">{users.length} {users.length === 1 ? 'usuário' : 'usuários'}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '38%' }}>Nome</th>
            <th style={{ width: '28%' }}>Login</th>
            <th style={{ width: '34%' }}>Papéis</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={3} className="table-empty">Nenhum usuário encontrado neste site.</td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.wp_user_id}>
                <td data-col="nome"><div className="pname">{u.name}</div></td>
                <td data-col="login"><span className="pfile mono">{u.slug}</span></td>
                <td data-col="papeis">
                  <div className="roles">
                    {u.roles.split(',').map((r) => r.trim()).filter(Boolean).map((role) => (
                      <span className="badge" key={role}>{role}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SettingsPanel({ settings, failure }: { settings: WpSettings | null; failure?: string }) {
  if (failure) return <FailureNotice title="Não foi possível ler as configurações" reason={failure} />;

  if (!settings) {
    return (
      <div className="panel-box">
        <p className="table-empty">Nenhuma configuração retornada por este site.</p>
      </div>
    );
  }

  const rows: [string, string][] = [
    ['Título', settings.title || '—'],
    ['Descrição', settings.description || '—'],
    ['URL', settings.url || '—'],
    ['E-mail do administrador', settings.admin_email || '—'],
    ['Fuso horário', settings.timezone || '—'],
    ['Idioma', settings.language || '—'],
  ];

  return (
    <div className="panel-box">
      <dl className="dl">
        {rows.map(([label, value]) => (
          <div className="dl-row" key={label}>
            <dt className="eyebrow">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Ordem fixa de exibição — a mesma dos seis testes em HEALTH_TESTS
 *  (src/lib/wp-health.ts). Não importamos daquele arquivo porque ele é
 *  `server-only`; este é um componente de cliente. */
const HEALTH_TEST_ORDER = [
  'authorization-header',
  'background-updates',
  'dotorg-communication',
  'https-status',
  'loopback-requests',
  'page-cache',
];

/** Nosso rótulo em português para o status — não é tradução do `label` do
 *  WordPress (esse vem como veio, no idioma do site), é o vocabulário que o
 *  resto do painel já usa para "Ativo"/"Inativo"/"falhou". */
const HEALTH_STATUS_LABEL: Record<HealthStatus, string> = {
  good: 'Boa',
  recommended: 'Recomendado',
  critical: 'Crítico',
  unknown: 'Desconhecido',
};

/** Classe do badge por status. 'critical' é o único que veste --red — regra
 *  de design do v3. 'recommended' é --amber (atenção, não alarme). 'good' é
 *  a variante silenciosa. 'unknown' reaproveita `.badge-unknown` (mudo,
 *  itálico), o mesmo tratamento da cobertura de atualização desconhecida em
 *  PluginTable — para nunca ler como 'good'. */
function healthBadgeClass(status: HealthStatus): string {
  switch (status) {
    case 'critical':
      return 'badge-critical';
    case 'recommended':
      return 'badge-recommended';
    case 'unknown':
      return 'badge-unknown';
    case 'good':
      return 'badge-good';
  }
}

/** Por que cada checagem importa, em português — não é tradução do `label`
 *  do WordPress (que já vem no idioma do site), é o contexto que falta nele:
 *  o que quebra na prática quando o teste não está 'good'. */
const HEALTH_GLOSS: Record<string, string> = {
  'authorization-header':
    'Se falhar, o servidor está removendo o cabeçalho Authorization antes de chegar ao PHP — é o que faz a autenticação por Application Password dar 401 mesmo com a senha certa. Corrige-se com uma regra no .htaccess.',
  'background-updates':
    'Se falhar, o site não consegue se atualizar sozinho — nem para lançamentos de segurança.',
  'dotorg-communication':
    'Sem isso, o site não enxerga que existem atualizações disponíveis no WordPress.org.',
  'https-status': 'Diz se o site está servindo por HTTPS.',
  'loopback-requests':
    'Se falhar, o WP-Cron está morto: nada agendado roda — posts agendados, atualização automática de plugins, plugins de backup.',
  'page-cache': 'Diz se foi detectado um cache de página no site.',
};

function HealthPanel({ health, failure }: { health: HealthCheck[]; failure?: string }) {
  if (failure) return <FailureNotice title="Não foi possível ler a saúde do site" reason={failure} />;

  if (health.length === 0) {
    return (
      <div className="panel-box">
        <p className="table-empty">Nenhuma checagem de saúde retornada por este site.</p>
      </div>
    );
  }

  const ordered = [...health].sort(
    (a, b) => HEALTH_TEST_ORDER.indexOf(a.test) - HEALTH_TEST_ORDER.indexOf(b.test),
  );

  return (
    <div className="tablewrap">
      <div className="tbar">
        <span className="count">{health.length} {health.length === 1 ? 'checagem' : 'checagens'}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '16%' }}>Status</th>
            <th style={{ width: '42%' }}>Diagnóstico do WordPress</th>
            <th style={{ width: '42%' }}>Por que importa</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((h) => (
            <tr key={h.test}>
              <td data-col="saude-status">
                <span className={`badge ${healthBadgeClass(h.status)}`}>{HEALTH_STATUS_LABEL[h.status]}</span>
              </td>
              <td data-col="diagnostico">
                <div className="pname">{h.label || '—'}</div>
                {h.badge && <div className="pfile">{h.badge}</div>}
              </td>
              <td data-col="motivo">
                <span className="eyebrow">{HEALTH_GLOSS[h.test] ?? '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** pt-BR para o `kind` de ContentActivity. */
const CONTENT_KIND_LABEL: Record<ContentActivity['kind'], string> = {
  post: 'post',
  page: 'página',
};

/**
 * `modified` chega do WordPress sem fuso (ver src/lib/wp-rest.ts e
 * sql/012_content_activity.sql) — é o horário LOCAL do site, na forma
 * `YYYY-MM-DDTHH:MM:SS`. Formatar isso com `new Date(modified)` reinterpretaria
 * a string como UTC ou como o fuso do runtime (navegador ou servidor,
 * dependendo de onde o componente renderiza) e inventaria um deslocamento que
 * a API nunca informou — exatamente o erro que este painel existe para não
 * cometer. Por isso o parse é feito com regex sobre o texto, nunca com `Date`.
 */
function formatSiteModified(modified: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(modified);
  if (!m) return modified || '—';
  const [, year, month, day, hour, minute] = m;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

/** Resolve `author_id` contra os usuários já carregados desta varredura.
 *  Sem correspondência (lista de usuários falhou, ou o autor não está nela)
 *  mostra o id puro com um rótulo neutro — nunca um nome inventado. */
function AuthorCell({ authorId, users }: { authorId: number; users: WpUser[] }) {
  const match = users.find((u) => u.wp_user_id === authorId);
  if (match) return <span className="pname">{match.name}</span>;
  return <span className="eyebrow">usuário #{authorId}</span>;
}

function ActivityPanel({
  content,
  users,
  settings,
  failure,
}: {
  content: ContentActivity[];
  users: WpUser[];
  settings: WpSettings | null;
  failure?: string;
}) {
  if (failure) return <FailureNotice title="Não foi possível ler a atividade de conteúdo" reason={failure} />;

  return (
    <div className="tablewrap">
      <div className="tbar">
        <span className="count">{content.length} {content.length === 1 ? 'item' : 'itens'}</span>
      </div>

      {/* Aviso obrigatório, sempre visível (nunca em tooltip): sem isto, "Autor:
          Fulano" ao lado de "alterado há 2 h" lê como "Fulano alterou há 2 h",
          o que pode ser falso — o WordPress não registra quem editou por
          último fora de revisões, que esta varredura não lê (ver
          src/lib/wp-rest.ts). O horário também é do próprio site, sem fuso
          informado pela API; nunca reapresentado como UTC ou como o fuso de
          quem está olhando. */}
      <p className="activity-disclaimer">
        Lista ordenada pela última alteração de cada conteúdo — não é um registro de quem editou.
        O autor mostrado é o autor <b>registrado</b> do conteúdo, não necessariamente quem fez a
        alteração mais recente: o WordPress não guarda essa informação fora de revisões, que esta
        varredura não lê. O horário é o horário local do site
        {settings?.timezone ? ` (fuso configurado no site: ${settings.timezone})` : ', sem fuso informado pela API'} —
        não convertido para UTC nem para o fuso de quem está vendo esta tela.
      </p>

      <table>
        <thead>
          <tr>
            <th style={{ width: '34%' }}>Título</th>
            <th style={{ width: '12%' }}>Tipo</th>
            <th style={{ width: '14%' }}>Status</th>
            <th style={{ width: '20%' }}>Alterado em (horário do site)</th>
            <th style={{ width: '20%' }}>Autor registrado</th>
          </tr>
        </thead>
        <tbody>
          {content.length === 0 ? (
            <tr>
              <td colSpan={5} className="table-empty">Nenhum conteúdo alterado recentemente neste site.</td>
            </tr>
          ) : (
            content.map((item) => (
              <tr key={`${item.kind}-${item.id}`}>
                <td data-col="titulo">
                  {item.link ? (
                    <a className="pname activity-link" href={item.link} target="_blank" rel="noreferrer">
                      {item.title || '(sem título)'}
                    </a>
                  ) : (
                    <div className="pname">{item.title || '(sem título)'}</div>
                  )}
                </td>
                <td data-col="tipo">
                  <span className="badge">{CONTENT_KIND_LABEL[item.kind]}</span>
                </td>
                <td data-col="status">
                  <span className="badge">{item.status || '—'}</span>
                </td>
                <td data-col="alterado">
                  <span className="mono">{formatSiteModified(item.modified)}</span>
                </td>
                <td data-col="autor">
                  <AuthorCell authorId={item.author_id} users={users} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
