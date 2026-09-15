import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, sessionForAuthPages } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Criar conta — dash-f2f' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await sessionForAuthPages()) redirect('/');

  async function signUp(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '');
    const { error: err } = await auth.signUp.email({
      email,
      password: String(formData.get('password') ?? ''),
      name: String(formData.get('name') ?? '') || email,
    });
    if (err) redirect(`/auth/sign-up?error=${encodeURIComponent(err.message ?? 'Falha ao criar conta.')}`);
    redirect('/');
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="mark">f2</span>
          <h1>dash-f2f</h1>
        </div>
        <p className="auth-sub">Crie a conta para guardar seus sites e o histórico de varreduras.</p>

        <form action={signUp} className="auth-form">
          <label className="eyebrow" htmlFor="name">Nome</label>
          <input className="field" id="name" name="name" type="text" autoComplete="name" />

          <label className="eyebrow" htmlFor="email">E-mail</label>
          <input className="field" id="email" name="email" type="email" required autoComplete="email" />

          <label className="eyebrow" htmlFor="password">Senha</label>
          <input className="field" id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />

          <button className="btn" type="submit">Criar conta</button>
        </form>

        {error && <p className="form-error" role="alert">{error}</p>}

        <p className="auth-alt">
          Já tem conta? <Link href="/auth/sign-in">Entrar</Link>
        </p>
      </div>
    </main>
  );
}
