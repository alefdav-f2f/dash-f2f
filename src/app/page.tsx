// Shell servidor: resolve a sessão, carrega os sites do usuário no Postgres e
// entrega para o dashboard interativo.

import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/Dashboard';
import { currentUser } from '@/lib/auth';
import { listSites } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect('/auth/sign-in');

  const sites = await listSites(user.id);

  return (
    <Dashboard
      sites={sites.map((s) => ({
        id: s.id,
        url: s.url,
        lastFetchedAt: s.last_fetched_at,
        lastOk: s.last_ok,
        lastOutdated: s.last_outdated,
        lastErrorKind: s.last_error_kind,
      }))}
      user={{ name: user.name ?? user.email, email: user.email }}
    />
  );
}
