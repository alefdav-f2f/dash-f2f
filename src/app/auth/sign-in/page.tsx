import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, sessionForAuthPages } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Entrar — dash-f2f' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await sessionForAuthPages()) redirect('/');

  async function signIn(formData: FormData) {
    'use server';
    const { error: err } = await auth.signIn.email({
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    });
    if (err) redirect(`/auth/sign-in?error=${encodeURIComponent(err.message ?? 'Falha ao entrar.')}`);
    redirect('/');
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="mark">f2</span>
          <h1>dash-f2f</h1>
        </div>
        <p className="auth-sub">Monitor somente leitura dos plugins dos seus sites WordPress.</p>

        <form action={signIn} className="auth-form">
          <label className="eyebrow" htmlFor="email">E-mail</label>
          <input className="field" id="email" name="email" type="email" required autoComplete="email" />

          <label className="eyebrow" htmlFor="password">Senha</label>
          <input className="field" id="password" name="password" type="password" required autoComplete="current-password" />

          <button className="btn" type="submit">Entrar</button>
        </form>

        {error && <p className="form-error" role="alert">{error}</p>}

        <p className="auth-alt">
          Não tem conta? <Link href="/auth/sign-up">Criar conta</Link>
        </p>
      </div>
    </main>
  );
}
