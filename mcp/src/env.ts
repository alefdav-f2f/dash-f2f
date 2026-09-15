// Carrega o .env.local do projeto quando o cliente MCP não injeta as variáveis.
//
// Clientes MCP (Claude Code, Claude Desktop, Cursor, …) não leem arquivos .env:
// eles passam só o que estiver no bloco `env` da configuração. Como as duas
// variáveis que o servidor precisa já vivem no .env.local do projeto, o próprio
// servidor vai buscá-las lá — assim conectar não exige repetir credencial em
// arquivo de configuração nenhum.
//
// Variável já presente no ambiente sempre vence: quem configurar explicitamente
// (outro banco, outra conta) não é sobrescrito.

import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

let loaded = false;

/** Sobe a partir de `from` procurando um `.env.local`. */
function findEnvFile(from: string): string | null {
  let dir = from;
  const { root } = parse(dir);
  while (true) {
    const candidate = join(dir, '.env.local');
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;

  if (process.env.DATABASE_URL_MCP && process.env.DASH_F2F_OWNER_EMAIL) return;

  // Procura a partir do build (mcp/dist/mcp/src) e, como reserva, do cwd.
  const envFile = findEnvFile(__dirname) ?? findEnvFile(process.cwd());
  if (!envFile) return;

  try {
    // process.loadEnvFile não sobrescreve variáveis já definidas.
    process.loadEnvFile(envFile);
  } catch {
    // Arquivo ilegível ou malformado: o servidor segue e falha adiante com a
    // mensagem específica de variável ausente, que é mais útil que um stack aqui.
  }
}
