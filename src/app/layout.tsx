import type { Metadata } from 'next';
import { Schibsted_Grotesk, Spline_Sans_Mono } from 'next/font/google';
import './globals.css';

// next/font auto-hospeda as fontes: zero request para o Google em runtime.
const grotesk = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-grotesk',
  display: 'swap',
});

const mono = Spline_Sans_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'dash-f2f — monitor de plugins WordPress',
  description:
    'Painel somente leitura do estado dos plugins de múltiplos sites WordPress.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${grotesk.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
