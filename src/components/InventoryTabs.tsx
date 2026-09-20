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
import type { HealthCheck, HealthStatus, InventoryResource, Plugin, Theme, WpSettings, WpUser } from '@/lib/types';

type TabKey = 'plugins' | 'themes' | 'users' | 'settings' | 'health';

const TAB_LABEL: Record<TabKey, string> = {
  plugins: 'Plugins',
  themes: 'Temas',
  users: 'Usuários',
  settings: 'Configurações',
  health: 'Saúde',
};

/** Só os quatro recursos best-effort podem aparecer em `failures`; plugins é
 *  obrigatório — se falhar, a varredura inteira falha antes de chegar aqui. */
const TAB_RESOURCE: Partial<Record<TabKey, InventoryResource>> = {
  themes: 'themes',
  users: 'users',
  settings: 'settings',
  health: 'health',
};

type Props = {
  plugins: Plugin[];
  themes: Theme[];
  users: WpUser[];
  settings: WpSettings | null;
  health: HealthCheck[];
  failures: Partial<Record<InventoryResource, string>>;
  filter: FilterKey;
  onFilter: (key: FilterKey) => void;
  changes: Record<string, Change[]>;
};

/** Quantas checagens de saúde merecem os olhos de alguém: tudo que não é
 *  'good'. 'recommended' é ação sugerida, 'critical' é alarme, 'unknown' é
 *  "não sabemos" — nenhum dos três é "está tudo bem", então os três contam.
 *  Só 'good' fica de fora. */
function healthAttentionCount(health: HealthCheck[]): number {
  return health.filter((h) => h.status !== 'good').length;
}

/** Quantos temas merecem os olhos de alguém: atualização pendente, ou
 *  update_source 'unknown' — mesma lógica de healthAttentionCount, "não
 *  sabemos" também não é "está tudo bem". Nenhum tema em nenhum dos dois
 *  casos → o chip fica sem número, como as outras abas calmas. */
function themeAttentionCount(themes: Theme[]): number {
  return themes.filter((t) => t.has_update || t.update_source === 'unknown').length;
}

export function InventoryTabs({ plugins, themes, users, settings, health, failures, filter, onFilter, changes }: Props) {
  const [tab, setTab] = useState<TabKey>('plugins');

  /** Contagem no chip quando o recurso é uma lista; "falhou" no lugar da
   *  contagem quando não conseguimos lê-lo. Configurações não é uma lista —
   *  não tem uma contagem que faça sentido, então o chip fica sem número
   *  enquanto está tudo bem, e só ganha o marcador quando falha. Saúde
   *  também fica sem número quando as seis checagens estão 'good' — um chip
   *  calmo para um site saudável, não "· 6" toda vez. */
  function chipLabel(key: TabKey): string {
    switch (key) {
      case 'plugins':
        return `${TAB_LABEL.plugins} · ${plugins.length}`;
      case 'themes': {
        if (failures.themes) return `${TAB_LABEL.themes} · falhou`;
        const attention = themeAttentionCount(themes);
        return attention > 0 ? `${TAB_LABEL.themes} · ${attention}` : TAB_LABEL.themes;
      }
      case 'users':
        return failures.users ? `${TAB_LABEL.users} · falhou` : `${TAB_LABEL.users} · ${users.length}`;
      case 'settings':
        return failures.settings ? `${TAB_LABEL.settings} · falhou` : TAB_LABEL.settings;
      case 'health': {
        if (failures.health) return `${TAB_LABEL.health} · falhou`;
        const attention = healthAttentionCount(health);
        return attention > 0 ? `${TAB_LABEL.health} · ${attention}` : TAB_LABEL.health;
      }
    }
  }

  return (
    <div className="inv">
      <div className="chips">
        {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => {
          const resource = TAB_RESOURCE[key];
          const failed = resource ? Boolean(failures[resource]) : false;
          return (
            <button
              key={key}
              type="button"
              // Não desabilita a aba com falha: desabilitar esconderia a
              // explicação atrás de um controle inerte. A aba continua
              // clicável e mostra o motivo no lugar da tabela.
              className={`chip${key === tab ? ' on' : ''}${failed ? ' chip-fail' : ''}`}
              aria-pressed={key === tab}
              onClick={() => setTab(key)}
            >
              {chipLabel(key)}
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
