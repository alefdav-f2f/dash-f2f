// Handler do Neon Auth: recebe as chamadas do client e as encaminha ao Neon.
import { auth } from '@/lib/auth';
import { getAllowedEmailDomains, isAllowedEmail } from '@/lib/allowed-email';

// O formulário de cadastro (src/app/auth/sign-up/page.tsx) checa o domínio
// antes de chamar `auth.signUp.email`, mas isso não fecha a porta: este route
// handler aceita POST direto em /api/auth/sign-up/email com corpo JSON,
// ignorando o formulário inteiramente. Já aconteceu nesta base — uma conta
// foi criada exatamente assim. Este wrapper é o portão de fato para quem bate
// na API crua.
//
// Só o sub-caminho de cadastro por e-mail é inspecionado. Todo o resto passa
// direto para o handler original, corpo incluído e sem modificação.
const { GET: originalGet, POST: originalPost } = auth.handler();

export const GET = originalGet;

type RouteContext = { params: Promise<{ path: string[] }> };

export async function POST(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const subPath = path.join('/');

  if (subPath === 'sign-up/email') {
    // O corpo de uma Request só pode ser lido uma vez. Clonamos antes de ler
    // para poder inspecionar o e-mail aqui e ainda entregar o Request
    // original, intocado, ao handler de verdade — que também precisa ler o
    // corpo (via request.text()) para repassar ao Neon Auth.
    const clone = request.clone();
    let email: string | undefined;
    try {
      const body = (await clone.json()) as { email?: unknown } | null;
      if (body && typeof body.email === 'string') email = body.email;
    } catch {
      // Corpo não é JSON válido — deixa o handler de verdade rejeitar isso
      // com o erro apropriado, não é nosso papel validar formato.
    }

    if (email !== undefined && !isAllowedEmail(email)) {
      return Response.json(
        {
          error: `Cadastro permitido apenas para e-mails dos domínios: ${getAllowedEmailDomains().join(', ')}.`,
        },
        { status: 403 },
      );
    }
  }

  return originalPost(request, context);
}
