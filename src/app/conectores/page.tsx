// Página do conector: a URL que se cola no Claude, no ChatGPT e afins.

import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Connectors } from '@/components/Connectors';
import { currentUser } from '@/lib/auth';
import { listTokens } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Conector MCP — dash-f2f' };

export default async function ConectoresPage() {
  const user = await currentUser();
  if (!user) redirect('/auth/sign-in');

  const [tokens, headerList] = await Promise.all([listTokens(user.id), headers()]);

  // A URL base sai do próprio request: em produção é o domínio da Vercel, em
  // desenvolvimento é o localhost — sem variável de ambiente para esquecer.
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const proto = headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const baseUrl = `${proto}://${host}`;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">f2</span>
          <h1>dash-f2f</h1>
          <span className="brand-sub">· conector MCP</span>
        </div>
        <div className="topbar-right">
          <span className="ro"><i /> somente leitura · GET</span>
          <Link className="ghost" href="/">Voltar ao painel</Link>
        </div>
      </header>

      <Connectors
        baseUrl={baseUrl}
        tokens={tokens.map((t) => ({
          id: t.id,
          name: t.name,
          prefix: t.prefix,
          createdAt: String(t.created_at),
          lastUsedAt: t.last_used_at ? String(t.last_used_at) : null,
        }))}
      />
    </>
  );
}
