// Cria (ou reaproveita) a role Postgres somente-leitura usada pelo MCP e grava
// a connection string dela em .env.local como DATABASE_URL_MCP.
//
// A senha é gerada aqui, nunca impressa e nunca versionada.
// Uso: npm run db:reader

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const ROLE = 'dash_f2f_reader';
// Lista de permissão: é assim, e só assim, que uma tabela nova vira legível
// pelo MCP. Ver o REVOKE ALL + ALTER DEFAULT PRIVILEGES abaixo.
const READ_TABLES = ['app_users', 'sites', 'scans', 'scan_plugins', 'scan_themes', 'scan_users', 'scan_settings'];
const ENV_PATH = join(process.cwd(), '.env.local');

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('DATABASE_URL ausente. Rode com: npm run db:reader');
  process.exit(1);
}

const sql = neon(adminUrl);
const env = readFileSync(ENV_PATH, 'utf8');

// Já existe? Então só reaplica os grants — não mexe na senha em uso.
const existing = (await sql`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`).length > 0;
const hasEnv = /^DATABASE_URL_MCP=/m.test(env);

let password = null;
if (!existing) {
  password = randomBytes(24).toString('base64url');
  await sql.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password.replace(/'/g, "''")}'`);
  console.log(`role ${ROLE} criada`);
} else if (!hasEnv) {
  // Role órfã (existe no banco, sem string no .env): redefine a senha.
  password = randomBytes(24).toString('base64url');
  await sql.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`);
  console.log(`role ${ROLE} já existia sem credencial local; senha redefinida`);
} else {
  console.log(`role ${ROLE} já existe e DATABASE_URL_MCP já está no .env.local`);
}

// Grants: negado por padrão, liberado só para o que está em READ_TABLES.
// Idempotente — pode rodar de novo a qualquer momento sem efeito colateral.
//
// 1) Zera qualquer privilégio que a role tenha hoje em qualquer tabela do
//    schema, inclusive o que tiver sido concedido manualmente ou por uma
//    versão antiga deste script.
await sql.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`);
// 2) A role ainda precisa enxergar o schema para fazer SELECT nele.
await sql.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
// 3) Concede SELECT só nas tabelas explicitamente permitidas.
for (const table of READ_TABLES) {
  await sql.query(`GRANT SELECT ON TABLE ${table} TO ${ROLE}`);
}
// 4) O padrão para tabela futura passa a ser "negado". Antes, ALTER DEFAULT
//    PRIVILEGES concedia SELECT em toda tabela nova, e cada tabela de
//    segredo precisava lembrar de se defender (ver sql/004_site_credentials.sql).
//    Invertido: uma tabela só vira legível quando alguém adiciona seu nome em
//    READ_TABLES, explicitamente.
await sql.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM ${ROLE}`);
console.log(`grants aplicados em: ${READ_TABLES.join(', ')}`);

if (password) {
  // Monta a URL do reader trocando as credenciais da URL de admin.
  const url = new URL(adminUrl);
  url.username = ROLE;
  url.password = password;
  const line = `DATABASE_URL_MCP=${url.toString()}`;
  const next = hasEnv
    ? env.replace(/^DATABASE_URL_MCP=.*$/m, line)
    : `${env.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_PATH, next, 'utf8');
  console.log('DATABASE_URL_MCP gravada em .env.local (valor não exibido)');
}
