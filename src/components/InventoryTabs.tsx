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
import type { InventoryResource, Plugin, Theme, WpSettings, WpUser } from '@/lib/types';

type TabKey = 'plugins' | 'themes' | 'users' | 'settings';

const TAB_LABEL: Record<TabKey, string> = {
  plugins: 'Plugins',
  themes: 'Temas',
  users: 'Usuários',
  settings: 'Configurações',
};

/** Só os três recursos best-effort podem aparecer em `failures`; plugins é
 *  obrigatório — se falhar, a varredura inteira falha antes de chegar aqui. */
const TAB_RESOURCE: Partial<Record<TabKey, InventoryResource>> = {
  themes: 'themes',
  users: 'users',
  settings: 'settings',
};

type Props = {
  plugins: Plugin[];
  themes: Theme[];
  users: WpUser[];
  settings: WpSettings | null;
  failures: Partial<Record<InventoryResource, string>>;
  filter: FilterKey;
  onFilter: (key: FilterKey) => void;
  changes: Record<string, Change[]>;
};

export function InventoryTabs({ plugins, themes, users, settings, failures, filter, onFilter, changes }: Props) {
  const [tab, setTab] = useState<TabKey>('plugins');

  /** Contagem no chip quando o recurso é uma lista; "falhou" no lugar da
   *  contagem quando não conseguimos lê-lo. Configurações não é uma lista —
   *  não tem uma contagem que faça sentido, então o chip fica sem número
   *  enquanto está tudo bem, e só ganha o marcador quando falha. */
  function chipLabel(key: TabKey): string {
    switch (key) {
      case 'plugins':
        return `${TAB_LABEL.plugins} · ${plugins.length}`;
      case 'themes':
        return failures.themes ? `${TAB_LABEL.themes} · falhou` : `${TAB_LABEL.themes} · ${themes.length}`;
      case 'users':
        return failures.users ? `${TAB_LABEL.users} · falhou` : `${TAB_LABEL.users} · ${users.length}`;
      case 'settings':
        return failures.settings ? `${TAB_LABEL.settings} · falhou` : TAB_LABEL.settings;
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
            <th style={{ width: '42%' }}>Tema</th>
            <th style={{ width: '30%' }}>Stylesheet</th>
            <th style={{ width: '14%' }}>Versão</th>
            <th style={{ width: '14%' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {themes.length === 0 ? (
            <tr>
              <td colSpan={4} className="table-empty">Nenhum tema instalado neste site.</td>
            </tr>
          ) : (
            themes.map((t) => (
              <tr key={t.stylesheet}>
                <td data-col="tema"><div className="pname">{t.name}</div></td>
                <td data-col="stylesheet"><span className="pfile mono">{t.stylesheet}</span></td>
                <td data-col="versao"><span className="ver">{t.version}</span></td>
                <td data-col="status">
                  <span className={`badge ${t.is_active ? 'badge-active' : 'badge-inactive'}`}>
                    {t.is_active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
              </tr>
            ))
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
