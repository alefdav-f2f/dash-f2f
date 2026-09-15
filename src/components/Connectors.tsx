'use client';

// Gera o token, monta a URL do conector e a entrega pronta para colar.
// O token em claro existe só na memória desta tela — recarregou, sumiu.

import { useState, useTransition } from 'react';
import { createTokenAction, revokeTokenAction } from '@/app/actions';

export type TokenItem = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type Props = {
  baseUrl: string;
  tokens: TokenItem[];
};

const CLIENTES = [
  {
    nome: 'Claude (app e web)',
    passos: 'Configurações → Conectores → Adicionar conector personalizado → cole a URL.',
  },
  {
    nome: 'ChatGPT',
    passos: 'Configurações → Conectores (modo desenvolvedor) → Novo conector → cole a URL.',
  },
  {
    nome: 'Claude Code / Cursor',
    passos: 'claude mcp add --transport http dash-f2f "<URL>"',
  },
];

export function Connectors({ baseUrl, tokens }: Props) {
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const freshUrl = fresh ? `${baseUrl}/api/mcp?token=${fresh}` : null;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const { token } = await createTokenAction(name || 'Conector MCP');
      setFresh(token);
      setCopied(false);
      setName('');
    });
  }

  async function copy() {
    if (!freshUrl) return;
    await navigator.clipboard.writeText(freshUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="conn">
      <section className="conn-head">
        <div className="eyebrow">Conector MCP</div>
        <h2>Ligue seus sites a um assistente</h2>
        <p>
          Gere uma URL e cole no Claude, no ChatGPT ou em qualquer cliente MCP. O assistente passa a
          responder sobre os seus sites — quais plugins estão desatualizados, o que mudou na última
          varredura, quem parou de responder. <strong>Somente leitura</strong>: nada é alterado no
          painel nem nos WordPress.
        </p>
      </section>

      <section className="panel-box">
        <form className="conn-form" onSubmit={handleCreate}>
          <div>
            <label className="eyebrow" htmlFor="token-name">Nome do conector</label>
            <input
              id="token-name"
              className="field"
              placeholder="Claude do notebook"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button className="btn btn-inline" type="submit" disabled={pending}>
            {pending ? 'Gerando…' : 'Gerar URL do conector'}
          </button>
        </form>

        {freshUrl && (
          <div className="conn-fresh">
            <div className="conn-fresh-head">
              <span className="eyebrow">Sua URL — copie agora</span>
              <button className="ghost" type="button" onClick={copy}>
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <code className="conn-url mono">{freshUrl}</code>
            <p className="conn-warn">
              Este é o único momento em que a URL completa aparece. Ela vale como senha de leitura:
              guarde no gerenciador de senhas e revogue aqui se vazar.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="eyebrow conn-section-title">Onde colar</div>
        <div className="conn-clients">
          {CLIENTES.map((c) => (
            <div className="conn-client" key={c.nome}>
              <b>{c.nome}</b>
              <p>{c.passos}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="eyebrow conn-section-title">Conectores ativos · {tokens.length}</div>
        {tokens.length === 0 ? (
          <p className="sites-empty">Nenhum conector gerado ainda.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>Nome</th>
                  <th style={{ width: '20%' }}>Início do token</th>
                  <th style={{ width: '22%' }}>Último uso</th>
                  <th style={{ width: '20%' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td data-col="plugin">
                      <div className="pname">{t.name}</div>
                      <div className="pfile">criado em {new Date(t.createdAt).toLocaleDateString('pt-BR')}</div>
                    </td>
                    <td><span className="ver">{t.prefix}…</span></td>
                    <td>
                      <span className="ver">
                        {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('pt-BR') : 'nunca usado'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="ghost"
                        type="button"
                        disabled={pending}
                        onClick={() => startTransition(() => revokeTokenAction(t.id))}
                      >
                        Revogar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="conn-foot">
        <div className="eyebrow conn-section-title">O que o assistente consegue ver</div>
        <p>
          Os sites cadastrados nesta conta, o inventário de plugins de cada varredura, o histórico e
          as diferenças entre varreduras. Nada além disso: a conexão com o banco usa um usuário que
          só tem permissão de leitura, as consultas são fixas e o assistente não escreve SQL.
        </p>
      </section>
    </main>
  );
}
