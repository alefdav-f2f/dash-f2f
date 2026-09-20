'use client';

// Cadastro da Application Password de um site.
//
// A senha só existe aqui no caminho de ida: é enviada à Server Action, cifrada
// e gravada. Nunca volta do servidor, nem mascarada.

import { useState, useTransition } from 'react';
import { deleteCredentialAction, saveCredentialAction } from '@/app/actions';
import { UNAUTHORIZED_CREDENTIAL_MESSAGE, type CredentialInfo } from '@/lib/types';

type Props = {
  siteId: string;
  siteUrl: string;
  current: CredentialInfo | null;
};

/**
 * Uma linha só, e só quando o último erro foi especificamente o 401 (não
 * qualquer falha) — checar via a mensagem fixa que src/lib/wp-rest.ts emite,
 * já que `CredentialInfo` guarda texto (`last_error`), não o `ApiErrorKind`
 * que o gerou. Mesma lógica de ranqueamento de src/components/States.tsx,
 * condensada: nunca afirma a causa, só ordena hipóteses.
 */
function unauthorizedHint(current: CredentialInfo): string | null {
  if (current.last_error !== UNAUTHORIZED_CREDENTIAL_MESSAGE) return null;

  if (current.last_verified_at === null) {
    return 'Nunca funcionou: verifique primeiro se o servidor não está descartando o cabeçalho Authorization (comum em Apache/CGI) antes de reconferir usuário e senha.';
  }

  const lastVerified = new Date(current.last_verified_at).toLocaleString('pt-BR');
  return `Funcionava até ${lastVerified}: a senha pode ter sido revogada no WordPress, ou a configuração do servidor mudou.`;
}

export function CredentialForm({ siteId, siteUrl, current }: Props) {
  const [wpUser, setWpUser] = useState(current?.wp_user ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hint = current ? unauthorizedHint(current) : null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveCredentialAction(siteId, wpUser, password);
      if (!result.ok) setError(result.error);
      else setPassword('');
    });
  }

  return (
    <form className="cred panel-box" onSubmit={handleSubmit}>
      <div className="eyebrow">Credencial de leitura</div>

      <p className="cred-help">
        No wp-admin de <span className="mono">{siteUrl}</span>: Usuários → Perfil →
        Senhas de aplicativo. Precisa ser conta de administrador — ler a lista de
        plugins exige a capability <span className="mono">activate_plugins</span>.
      </p>

      <label className="eyebrow" htmlFor={`u-${siteId}`}>Usuário</label>
      <input
        id={`u-${siteId}`}
        className="field"
        value={wpUser}
        onChange={(e) => setWpUser(e.target.value)}
        autoComplete="off"
        placeholder="admin"
      />

      <label className="eyebrow" htmlFor={`p-${siteId}`}>Application Password</label>
      <input
        id={`p-${siteId}`}
        className="field"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="off"
        placeholder={current ? '•••• já cadastrada — preencha para substituir' : 'abcd EFGH ijkl MNOP qrst UVWX'}
      />

      {error && <p className="cred-error">{error}</p>}

      {current?.last_error && (
        <p className="cred-error">Última tentativa falhou: {current.last_error}</p>
      )}

      {hint && <p className="cred-help">{hint}</p>}

      {current?.last_verified_at && !current.last_error && (
        <p className="cred-ok">
          Funcionando · verificada em {new Date(current.last_verified_at).toLocaleString('pt-BR')}
        </p>
      )}

      <div className="cred-actions">
        <button className="btn btn-inline" type="submit" disabled={pending}>
          {pending ? 'Salvando…' : current ? 'Substituir' : 'Salvar'}
        </button>
        {current && (
          <button
            type="button"
            className="ghost"
            disabled={pending}
            onClick={() => startTransition(() => deleteCredentialAction(siteId))}
          >
            Remover
          </button>
        )}
      </div>
    </form>
  );
}
