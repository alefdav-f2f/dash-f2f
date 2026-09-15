'use client';

// Formulário de entrada: normaliza a URL, salva na lista e dispara a consulta.

import { useState } from 'react';
import { normalizeSiteUrl, InvalidSiteUrlError } from '@/lib/site-url';

type Props = {
  onSubmit: (siteUrl: string) => void;
  busy?: boolean;
};

export function SiteForm({ onSubmit, busy }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const url = normalizeSiteUrl(value);
      setError(null);
      setValue('');
      onSubmit(url); // o pai cuida de salvar no LocalStorage e consultar
    } catch (err) {
      setError(err instanceof InvalidSiteUrlError ? err.message : 'URL inválida.');
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} autoComplete="off" noValidate>
      <label className="eyebrow" htmlFor="site-input">Adicionar site</label>
      <input
        id="site-input"
        className="field"
        type="text"
        inputMode="url"
        spellCheck={false}
        placeholder="https://exemplo.com"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'site-error' : undefined}
      />
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Consultando…' : 'Adicionar e consultar'}
      </button>
      {error && <p className="form-error" id="site-error" role="alert">{error}</p>}
    </form>
  );
}
