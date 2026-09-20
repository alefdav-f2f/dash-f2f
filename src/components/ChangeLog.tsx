'use client';

// "O que mudou desde a varredura anterior" — o valor que só existe porque
// agora há histórico no Postgres.
//
// Importante: isto é comparação de estado entre duas varreduras, não um log
// de auditoria. O WordPress não registra quem fez cada mudança — só o estado
// em cada momento em que o painel consultou o site. O aviso abaixo existe
// para que ninguém confunda uma coisa com a outra.

import { CHANGE_LABEL, type Change } from '@/lib/diff';
import type { WpSettings } from '@/lib/types';

type Props = {
  /** Mudanças de plugin (sem `resource`). */
  changes: Change[];
  /** Mudanças de usuário, tema e configurações (cada uma com `resource`). */
  resourceChanges: Change[];
  previousScanAt: string | null;
};

/** Rótulo em pt-BR para os campos de `wp_options` que `diffSettings` compara.
 *  Ficou de propósito fora de `diff.ts` — a camada de diff não sabe de UI. */
const SETTINGS_FIELD_LABEL: Record<keyof WpSettings, string> = {
  title: 'Título do site',
  description: 'Descrição (tagline)',
  url: 'URL do site',
  admin_email: 'E-mail do administrador',
  timezone: 'Fuso horário',
  language: 'Idioma',
};

type GroupKey = 'plugins' | 'user' | 'theme' | 'settings';

const GROUP_LABEL: Record<GroupKey, string> = {
  plugins: 'Plugins',
  user: 'Usuários',
  theme: 'Temas',
  settings: 'Configurações',
};

const GROUP_ORDER: GroupKey[] = ['plugins', 'user', 'theme', 'settings'];

const hasAdminRole = (roles: string) =>
  roles.split(',').map((r) => r.trim()).includes('administrator');

/** Usuário criado já como administrator entre duas varreduras — mesmo risco
 *  de uma elevação, mas `kind` continua `'new'` porque, do ponto de vista do
 *  diff, é isso que é. Quem decide se isso é "só um novo usuário" ou algo que
 *  merece --red é a UI, com este teste. */
const isNewAdminUser = (c: Change) =>
  c.resource === 'user' && c.kind === 'new' && !!c.to && hasAdminRole(c.to);

/** admin_email é o clássico sinal de account takeover: quem controla esse
 *  e-mail controla o "esqueci minha senha" de todo o site. */
const isAdminEmailChange = (c: Change) =>
  c.resource === 'settings' && c.kind === 'setting-changed' && c.file === 'admin_email';

/** As quatro faces do mesmo risco — alguém ganhando (ou controlando) acesso
 *  administrativo — que justificam sair do cinza padrão e usar --red. */
const isSecurityRelevant = (c: Change) =>
  c.kind === 'admin-elevated' || c.kind === 'admin-demoted' || isNewAdminUser(c) || isAdminEmailChange(c);

function badgeClass(c: Change): string {
  if (c.kind === 'admin-demoted') return 'chg chg-admin-demoted';
  if (c.kind === 'admin-elevated' || isNewAdminUser(c) || isAdminEmailChange(c)) return 'chg chg-admin-elevated';
  return `chg chg-${c.kind}`;
}

function badgeLabel(c: Change): string {
  if (isNewAdminUser(c)) return 'criado como administrador';
  if (isAdminEmailChange(c)) return 'e-mail do admin alterado';
  return CHANGE_LABEL[c.kind];
}

function displayName(c: Change): string {
  if (c.resource === 'settings') {
    return SETTINGS_FIELD_LABEL[c.file as keyof WpSettings] ?? c.name;
  }
  return c.name;
}

/** Papéis vêm como string separada por vírgula ("administrator,editor"); só
 *  para leitura, não altera o dado. */
function displayValue(c: Change, value: string): string {
  return c.resource === 'user' ? value.split(',').map((r) => r.trim()).join(', ') : value;
}

export function ChangeLog({ changes, resourceChanges, previousScanAt }: Props) {
  if (!previousScanAt) {
    return (
      <p className="changelog-none">
        Primeira varredura deste site — o comparativo aparece a partir da próxima.
      </p>
    );
  }

  const since = new Date(previousScanAt).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const total = changes.length + resourceChanges.length;

  if (total === 0) {
    return <p className="changelog-none">Nada mudou desde a varredura de {since}.</p>;
  }

  // resourceChanges (ao contrário de changes) sempre traz `resource` — vem só
  // de diffUsers/diffThemes/diffSettings, nunca de diffScans.
  const groups: Record<GroupKey, Change[]> = { plugins: changes, user: [], theme: [], settings: [] };
  for (const c of resourceChanges) {
    if (c.resource === 'user' || c.resource === 'theme' || c.resource === 'settings') groups[c.resource].push(c);
  }

  return (
    <div className="changelog">
      <div className="changelog-head">
        <span className="eyebrow">Mudou desde {since}</span>
        <span className="count">{total} {total === 1 ? 'mudança' : 'mudanças'}</span>
      </div>

      {/* O ponto mais importante desta tela: o painel compara duas fotos do
          site, não observa quem mexeu em nada. Sem isto, "usuário promovido a
          administrador" parece um log de auditoria — e não é. */}
      <p className="changelog-disclaimer">
        Estas são diferenças entre a varredura de {since} e a varredura atual — o WordPress não
        registra quem fez cada mudança, o painel apenas compara o estado do site entre as duas.
      </p>

      {GROUP_ORDER.filter((key) => groups[key].length > 0).map((key) => (
        <ChangeGroup key={key} label={GROUP_LABEL[key]} items={groups[key]} showsInTable={key === 'plugins'} />
      ))}
    </div>
  );
}

/** Acima disso o grupo vira ruído; para plugins o resto ainda fica marcado na
 *  tabela — para usuário/tema/configurações não há tabela marcada, então o
 *  texto de "sobra" é diferente. */
const MAX_VISIBLE = 5;

function ChangeGroup({ label, items, showsInTable }: { label: string; items: Change[]; showsInTable: boolean }) {
  const visible = items.slice(0, MAX_VISIBLE);
  const hidden = items.length - visible.length;

  return (
    <div className="changelog-group">
      <div className="changelog-group-head">{label} · {items.length}</div>
      <ul className="changelog-list">
        {visible.map((c, i) => (
          <li key={`${c.resource ?? 'plugin'}-${c.file}-${c.kind}-${i}`} className={isSecurityRelevant(c) ? 'chg-row-alert' : undefined}>
            <span className={badgeClass(c)}>{badgeLabel(c)}</span>
            <span className="chg-name">{displayName(c)}</span>
            {c.from && c.to && (
              <span className="chg-ver mono">{displayValue(c, c.from)} → {displayValue(c, c.to)}</span>
            )}
            {c.from && !c.to && <span className="chg-ver mono">{displayValue(c, c.from)}</span>}
            {!c.from && c.to && <span className="chg-ver mono">{displayValue(c, c.to)}</span>}
          </li>
        ))}
        {hidden > 0 && (
          <li className="changelog-more">
            + {hidden} {hidden === 1 ? 'mudança' : 'mudanças'}
            {showsInTable ? ' marcadas na tabela abaixo' : ''}
          </li>
        )}
      </ul>
    </div>
  );
}
