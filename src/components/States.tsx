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
function errorCopy(kind: ApiErrorKind, message: string, credentialLastVerifiedAt?: string | null) {
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
    case 'unauthorized': {
      const title = 'Credencial recusada · 401';

      // Testado contra um WordPress real: sem credencial, com senha errada ou
      // com usuário inexistente, o core devolve a MESMA resposta 401 — não dá
      // para diferenciar essas causas daqui. Por isso este texto nunca afirma
      // qual é a causa; só ordena hipóteses pelo único sinal que temos
      // (last_verified_at) e diz o que checar. Ver plano da Fase 4, tarefa 5.

      // Sinal indisponível (não é o caminho comum: só acontece se algo falhar
      // ao consultar o histórico da credencial) — cai na redação neutra
      // original em vez de adivinhar.
      if (credentialLastVerifiedAt === undefined) {
        return {
          title,
          body: (
            <>
              O WordPress rejeitou a Application Password. Ela pode ter sido revogada — ou o
              servidor está descartando o cabeçalho <code>Authorization</code>, o que é comum
              em Apache/CGI e se resolve com uma regra no <code>.htaccess</code>.
            </>
          ),
        };
      }

      // Nunca verificou: é o primeiro cadastro. A causa mais comum neste caso
      // é o servidor descartando o cabeçalho Authorization antes de chegar ao
      // PHP — típico de Apache/CGI — então essa é a primeira coisa a checar.
      if (credentialLastVerifiedAt === null) {
        return {
          title,
          body: (
            <>
              Esta credencial nunca chegou a funcionar. A causa mais comum nesse caso é o
              servidor descartando o cabeçalho <code>Authorization</code> antes de chegar ao
              WordPress — típico de hospedagem Apache/CGI. Verifique isso primeiro: normalmente
              se resolve com uma regra no <code>.htaccess</code> (ex.:{' '}
              <code>SetEnvIf Authorization</code>). Só depois vale reconferir usuário e senha.
            </>
          ),
        };
      }

      // Já verificou antes e parou de funcionar: revogação é a hipótese mais
      // provável, mas uma mudança na configuração do servidor também explica.
      const lastVerified = new Date(credentialLastVerifiedAt).toLocaleString('pt-BR');
      return {
        title,
        body: (
          <>
            Esta credencial funcionava — a última verificação bem-sucedida foi em{' '}
            {lastVerified}. A hipótese mais provável é a Application Password ter sido
            revogada no WordPress; uma mudança na configuração do servidor (por exemplo, ele
            passou a descartar o cabeçalho <code>Authorization</code>) também pode explicar.
            Não dá para saber qual daqui — verifique as duas.
          </>
        ),
      };
    }
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

export function ErrorState({
  kind,
  message,
  credentialLastVerifiedAt,
}: {
  kind: ApiErrorKind;
  message: string;
  /** Só relevante para kind 'unauthorized'. Ver ApiErrorPayload em @/lib/types. */
  credentialLastVerifiedAt?: string | null;
}) {
  const copy = errorCopy(kind, message, credentialLastVerifiedAt);
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
