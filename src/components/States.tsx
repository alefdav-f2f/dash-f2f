'use client';

// Estados da área principal: carregando, erro e vazio.

import { displayUrl } from '@/lib/site-url';
import type { ApiErrorKind } from '@/lib/types';

const PLUGINS_PATH = '/wp-json/wp/v2/plugins';
const SKELETON_WIDTHS = ['72%', '58%', '81%', '64%', '47%'];

export function LoadingState({ site }: { site: string }) {
  return (
    <div className="panel-box">
      <div className="load">
        <span className="spin" aria-hidden />
        Consultando <span className="mono">{displayUrl(site)}</span>…
      </div>
      <div className="endpoint mono">GET {PLUGINS_PATH}</div>
      {SKELETON_WIDTHS.map((w, i) => (
        <div className="skrow" key={i}>
          <span className="sk" style={{ width: w }} />
          <span className="sk" />
          <span className="sk" style={{ opacity: 0.5 }} />
          <span className="sk" />
        </div>
      ))}
    </div>
  );
}

/** Mensagem por tipo de falha — o app nunca quebra, só explica. */
function errorCopy(kind: ApiErrorKind, message: string) {
  switch (kind) {
    case 'not_found':
      return {
        title: 'Endpoint não encontrado · 404',
        body: (
          <>
            <code>{PLUGINS_PATH}</code> não respondeu neste site. A API REST do WordPress
            provavelmente está desabilitada ou sendo bloqueada — comum em plugins de segurança
            ou num WAF na frente do site.
          </>
        ),
      };
    case 'network':
      return {
        title: 'Não foi possível ler este site',
        body: <>{message} Verifique se o domínio está correto e se o site responde publicamente.</>,
      };
    case 'bad_payload':
      return {
        title: 'Resposta inesperada',
        body: <>{message} O endpoint deve devolver um array de plugins em JSON.</>,
      };
    case 'invalid_url':
      return { title: 'URL inválida', body: <>{message}</>, muted: true };
    case 'no_credential':
      return {
        title: 'Site sem credencial',
        body: (
          <>
            Este site ainda não tem Application Password cadastrada. Gere uma no wp-admin
            em Usuários → Perfil → Senhas de aplicativo e cadastre aqui.
          </>
        ),
      };
    case 'bad_credential':
      return {
        title: 'Credencial ilegível',
        body: (
          <>
            A credencial gravada para este site não pôde ser decifrada — provavelmente a
            <code>CREDENTIALS_KEY</code> do servidor mudou depois que ela foi salva.
            Cadastre a Application Password novamente.
          </>
        ),
      };
    case 'unauthorized':
      return {
        title: 'Credencial recusada · 401',
        body: (
          <>
            O WordPress rejeitou a Application Password. Ela pode ter sido revogada — ou o
            servidor está descartando o cabeçalho <code>Authorization</code>, o que é comum
            em Apache/CGI e se resolve com uma regra no <code>.htaccess</code>.
          </>
        ),
      };
    case 'forbidden':
      return {
        title: 'Sem permissão · 403',
        body: (
          <>
            O usuário autenticou mas não tem permissão para ler plugins. Essa leitura exige a
            capability <code>activate_plugins</code> — na prática, uma conta de administrador.
          </>
        ),
      };
    default:
      return { title: 'O site respondeu com erro', body: <>{message}</> };
  }
}

export function ErrorState({ kind, message }: { kind: ApiErrorKind; message: string }) {
  const copy = errorCopy(kind, message);
  return (
    <div className={`err${'muted' in copy && copy.muted ? ' mut' : ''}`} role="alert">
      <b>{copy.title}</b>
      <p>{copy.body}</p>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  onCta,
}: {
  title: string;
  body: string;
  onCta?: () => void;
}) {
  return (
    <div className="panel-box">
      <div className="empty">
        <div className="stampbox">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#C5C0B0" strokeWidth="1.4" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 4v5" />
          </svg>
        </div>
        <h3>{title}</h3>
        <p>{body}</p>
        {onCta && (
          <button className="btn btn-inline" type="button" onClick={onCta}>
            Adicionar primeiro site
          </button>
        )}
      </div>
    </div>
  );
}
