// Next.js 16: o antigo `middleware.ts` chama-se `proxy.ts`.
// Protege tudo, menos o próprio fluxo de auth, o cron (autenticado por segredo)
// e os assets estáticos.

import { auth } from '@/lib/auth';

export default auth.middleware({ loginUrl: '/auth/sign-in' });

export const config = {
  matcher: ['/((?!api/auth|api/cron|auth|_next/static|_next/image|favicon.ico).*)'],
};
