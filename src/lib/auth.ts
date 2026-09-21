import 'server-only';

// Neon Auth — instância única usada por Server Components, Server Actions,
// Route Handlers e pelo proxy (middleware) de proteção de rotas.

import { cache } from 'react';
import { createNeonAuth } from '@neondatabase/auth/next/server';
import { isAllowedEmail } from './allowed-email';
import { upsertUser } from './db';

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
    sessionDataTtl: 300,
  },
});

type SessionUser = NonNullable<NonNullable<Awaited<ReturnType<typeof auth.getSession>>['data']>['user']>;

// Ponto de extensão para verificação de e-mail — DESLIGADO por padrão.
//
// `isAllowedEmail` só restringe qual STRING de e-mail é aceita; ela não prova
// que quem está logado é dono daquela caixa de entrada. Quem prova posse é a
// verificação de e-mail do Neon Auth (`emailVerified`). Sem ela, "domínio
// certo" e "dono verificado" são coisas diferentes, e depois que os sites
// passam a ser compartilhados entre toda a equipe, essa diferença importa: uma
// conta `@f2f-digital.com` inventada por alguém que só digitou esse domínio no
// cadastro — sem nunca ter provado acesso à caixa — passaria a enxergar o
// inventário de TODOS os clientes, não mais só os próprios.
//
// Continua desligado porque hoje ligar isso trancaria a equipe inteira para
// fora: as duas contas existentes (alef.coelho.ptn@f2f-digital.com,
// desenvolvimento@f2f-digital.com) têm `emailVerified: false`, e o Neon Auth
// deste projeto ainda não está configurado para enviar e-mail de verificação.
// Antes de setar `REQUIRE_EMAIL_VERIFIED=1`:
//   1. Configurar o Neon Auth para enviar e-mail de verificação.
//   2. Verificar as contas existentes (ou recriá-las já verificadas).
// Só depois disso ligar a env var — do contrário é lockout total.
function passesEmailVerificationGate(user: SessionUser): boolean {
  if (process.env.REQUIRE_EMAIL_VERIFIED !== '1') return true;
  return user.emailVerified === true;
}

/**
 * Decide se a sessão de `user` (já sabido não-nulo) pode ser tratada como
 * logada pelo resto do app: domínio permitido (Task 1/2/3) e, se
 * `REQUIRE_EMAIL_VERIFIED=1`, e-mail verificado. Usada tanto por
 * `currentUser` quanto por `sessionForAuthPages` para que as duas funções
 * concordem sobre quem está "de fato" logado — se divergissem, um usuário
 * fora do domínio ficaria preso num loop de redirecionamento entre `/` e
 * `/auth/sign-in`.
 */
function isSessionAllowed(user: SessionUser): boolean {
  if (!isAllowedEmail(user.email)) return false;
  return passesEmailVerificationGate(user);
}

/**
 * Sessão atual ou `null`. Não lança.
 * Deduplicado por request com `cache()`, então o espelho em `app_users` roda no
 * máximo uma vez por requisição.
 *
 * Sessão de e-mail fora do domínio permitido (ou, com `REQUIRE_EMAIL_VERIFIED`
 * ligado, não verificado) devolve `null` — indistinguível de "sem sessão" para
 * quem chama. Isso cobre conta criada por qualquer caminho, inclusive antes
 * desta regra existir ou direto no Neon Auth, por fora do nosso app.
 *
 * A checagem roda ANTES do espelho em `app_users`: aquela tabela é o que o
 * conector MCP usa para resolver e-mail → usuário, então jamais espelhar um
 * usuário fora do domínio — seria dar a ele um pé na porta ali.
 */
export const currentUser = cache(async () => {
  const { data } = await auth.getSession();
  const user = data?.user ?? null;
  if (!user || !isSessionAllowed(user)) return null;
  const { id, email, name } = user;

  // Falha aqui não pode derrubar a sessão: o espelho é conveniência, não
  // fonte de verdade da autenticação.
  try {
    await upsertUser({ id, email, name });
  } catch (err) {
    console.warn('[auth] não foi possível espelhar o usuário em app_users:', err);
  }
  return user;
});

/**
 * Leitura de sessão para as páginas de `/auth`, que ficam FORA do proxy.
 * Sem o proxy à frente, `getSession()` pode tentar renovar o cookie — e um
 * Server Component não tem permissão para escrever cookie, o que derrubava a
 * tela de login com 500. Aqui a falha vira "sem sessão": o visitante vê o
 * formulário, que é o comportamento correto para essa rota.
 *
 * Aplica a MESMA regra de domínio/verificação que `currentUser` (via
 * `isSessionAllowed`), sem o espelho em `app_users` — aqui não há usuário
 * "de verdade" para espelhar. Motivo de aplicar a regra aqui também: as
 * páginas de `/auth/sign-in` e `/auth/sign-up` redirecionam para `/` quando
 * já existe sessão. Se tratassem sessão fora do domínio como válida, um
 * usuário assim seria mandado para `/`, que por sua vez usa `currentUser` e
 * o manda de volta para `/auth/sign-in` — loop infinito de redirecionamento.
 * Tratando como "sem sessão" aqui, ele simplesmente vê o formulário de login,
 * que é o comportamento correto: a conta existe, mas não está autorizada.
 */
export async function sessionForAuthPages() {
  try {
    const { data } = await auth.getSession();
    const user = data?.user ?? null;
    return user && isSessionAllowed(user) ? user : null;
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
