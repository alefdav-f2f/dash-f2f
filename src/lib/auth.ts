import 'server-only';

// Neon Auth — instância única usada por Server Components, Server Actions,
// Route Handlers e pelo proxy (middleware) de proteção de rotas.

import { cache } from 'react';
import { createNeonAuth } from '@neondatabase/auth/next/server';
import { upsertUser } from './db';

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
    sessionDataTtl: 300,
  },
});

/**
 * Sessão atual ou `null`. Não lança.
 * Deduplicado por request com `cache()`, então o espelho em `app_users` roda no
 * máximo uma vez por requisição.
 */
export const currentUser = cache(async () => {
  const { data } = await auth.getSession();
  const user = data?.user ?? null;
  if (user) {
    // Falha aqui não pode derrubar a sessão: o espelho é conveniência, não
    // fonte de verdade da autenticação.
    try {
      await upsertUser({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      console.warn('[auth] não foi possível espelhar o usuário em app_users:', err);
    }
  }
  return user;
});

/**
 * Leitura de sessão para as páginas de `/auth`, que ficam FORA do proxy.
 * Sem o proxy à frente, `getSession()` pode tentar renovar o cookie — e um
 * Server Component não tem permissão para escrever cookie, o que derrubava a
 * tela de login com 500. Aqui a falha vira "sem sessão": o visitante vê o
 * formulário, que é o comportamento correto para essa rota.
 */
export async function sessionForAuthPages() {
  try {
    const { data } = await auth.getSession();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

/** Usuário autenticado ou erro — para rotas que já rodam atrás do proxy. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  return user;
}
