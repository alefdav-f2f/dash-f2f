'use client';

// Cadastro da Application Password de um site.
//
// A senha só existe aqui no caminho de ida: é enviada à Server Action, cifrada
// e gravada. Nunca volta do servidor, nem mascarada.

import { useState, useTransition } from 'react';
import { deleteCredentialAction, saveCredentialAction } from '@/app/actions';
import type { CredentialInfo } from '@/lib/types';

type Props = {
  siteId: string;
  siteUrl: string;
  current: CredentialInfo | null;
};

export function CredentialForm({ siteId, siteUrl, current }: Props) {
  const [wpUser, setWpUser] = useState(current?.wp_user ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
