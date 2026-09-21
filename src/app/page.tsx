// Shell servidor: resolve a sessão, carrega os sites da equipe no Postgres e
// entrega para o dashboard interativo.

import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/Dashboard';
import { currentUser } from '@/lib/auth';
import { listSites } from '@/lib/db';
import { listCredentialStatuses } from '@/lib/credentials';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect('/auth/sign-in');

  // Duas queries independentes, em paralelo — não uma por site (N+1).
  const [sites, credentials] = await Promise.all([
    listSites(),
    listCredentialStatuses(),
  ]);

  return (
    <Dashboard
      sites={sites.map((s) => {
        const cred = credentials.get(s.id);
        return {
          id: s.id,
          url: s.url,
          lastFetchedAt: s.last_fetched_at,
          lastOk: s.last_ok,
          lastOutdated: s.last_outdated,
          lastErrorKind: s.last_error_kind,
          addedBy: s.added_by_name ?? s.added_by_email ?? null,
          credential: cred
            ? { wp_user: cred.wp_user, last_verified_at: cred.last_verified_at, last_error: cred.last_error }
            : null,
        };
      })}
      user={{ name: user.name ?? user.email, email: user.email }}
    />
  );
}
