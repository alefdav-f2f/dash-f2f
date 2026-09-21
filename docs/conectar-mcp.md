# Como conectar o MCP do dash-f2f

Guia para ligar o MCP a um agente. Ele é **somente leitura**: expõe os sites
monitorados e o histórico de varreduras da equipe inteira (não só os que a sua
conta cadastrou), sem tocar no painel nem nos WordPress.

Há dois caminhos, e o certo depende de onde o assistente roda:

| | **Conector remoto** (URL) | **Servidor local** (stdio) |
|---|---|---|
| para quem | Claude no app/web, ChatGPT, qualquer cliente hospedado | Claude Code, Cursor, VS Code, Claude Desktop |
| como | gera a URL em `/conectores` e cola | aponta para o build local |
| exige | o painel no ar (Vercel) | o repositório na máquina |
| autentica com | token pessoal na URL | `.env.local` do projeto |

> **Atalho:** se você só quer usar no Claude ou no ChatGPT, vá direto para a
> seção 2 — não precisa de nada instalado.

---

## 0. Conector remoto — a URL que se cola

1. Abra o painel e clique em **Conector MCP** (canto superior direito), ou vá em
   `/conectores`.
2. Dê um nome ("Claude do notebook") e clique em **Gerar URL do conector**.
3. Copie a URL. Ela sai neste formato:

```
https://dash-f2f.vercel.app/api/mcp?token=dashf2f_…
```

A URL completa aparece **uma única vez**. Ela vale como senha de leitura da sua
conta: guarde no gerenciador de senhas. Se vazar, é só clicar em **Revogar** na
mesma tela — o acesso cai na hora, sem precisar mexer em mais nada.

Onde colar:

- **Claude (app e web)** — Configurações → Conectores → Adicionar conector
  personalizado → cole a URL.
- **ChatGPT** — Configurações → Conectores (modo desenvolvedor) → Novo conector →
  cole a URL.
- **Claude Code / Cursor** — `claude mcp add --transport http dash-f2f "<URL>"`.

Clientes que só aceitam autenticação OAuth ainda não são atendidos: o conector
autentica por token (na URL ou em `Authorization: Bearer`). Nesse caso use o
servidor local abaixo.

> **Para o conector remoto funcionar em produção**, a Vercel precisa ter a
> variável `DATABASE_URL_MCP` (a da role somente-leitura). Sem ela, `/api/mcp`
> responde `503` explicando o que falta.

---

## 1. Servidor local — preparar uma vez

Só para o caminho local (stdio). Na raiz do projeto:

```bash
npm install
npm run db:migrate    # tabelas, inclusive app_users
npm run db:reader     # cria a role read-only e grava DATABASE_URL_MCP no .env.local
npm run mcp:build     # compila para mcp/dist
```

Depois confirme que o `.env.local` tem as duas linhas que o MCP usa:

```
DATABASE_URL_MCP=postgres://dash_f2f_reader:…     # criada por `npm run db:reader`
DASH_F2F_OWNER_EMAIL=voce@f2f-digital.com         # identifica a conexão; não recorta o que as tools devolvem
```

O e-mail precisa **já ter entrado no painel pelo menos uma vez** — é o primeiro
acesso autenticado que cria a linha em `app_users` — e estar num domínio
permitido (`ALLOWED_EMAIL_DOMAINS`). Os sites são da equipe inteira
(`sql/011_shared_sites.sql`): esse e-mail só identifica quem abriu a conexão,
não filtra o inventário que as ferramentas devolvem.

Teste sem nenhum cliente:

```bash
npm run mcp:test     # 28 testes: acesso por domínio e token, negação de escrita, handshake real
```

> **Não copie a `DATABASE_URL` do app para o MCP.** Ela tem permissão de escrita.
> A string certa é a `DATABASE_URL_MCP`, da role `dash_f2f_reader`, que só tem
> `SELECT`.

---

## 2. Servidor local — conectar

O servidor lê o `.env.local` do projeto sozinho, então a configuração do cliente
**não precisa declarar credencial nenhuma**.

### Claude Code

O repositório já traz um `.mcp.json` na raiz:

```json
{
  "mcpServers": {
    "dash-f2f": {
      "command": "node",
      "args": ["./mcp/dist/mcp/src/server.js"]
    }
  }
}
```

Abra o Claude Code nesta pasta e aprove o servidor quando ele perguntar (isso
acontece uma vez por projeto). Para conferir:

```bash
claude mcp list
```

Ou, dentro da sessão, `/mcp` — o `dash-f2f` deve aparecer como conectado, com as
13 ferramentas.

Se preferir registrar manualmente, sem usar o `.mcp.json`:

```bash
claude mcp add dash-f2f -- node ./mcp/dist/mcp/src/server.js
```

### Claude Desktop

Edite o `claude_desktop_config.json`:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dash-f2f": {
      "command": "node",
      "args": ["D:\\workspace\\F2F\\dash-f2f\\mcp\\dist\\mcp\\src\\server.js"]
    }
  }
}
```

Caminho **absoluto** aqui — o Desktop não roda a partir da pasta do projeto.
Reinicie o app depois de salvar.

### Cursor

`.cursor/mcp.json` no projeto (ou `~/.cursor/mcp.json` para valer em todos):

```json
{
  "mcpServers": {
    "dash-f2f": {
      "command": "node",
      "args": ["./mcp/dist/mcp/src/server.js"]
    }
  }
}
```

### VS Code (Copilot)

`.vscode/mcp.json` — repare que a chave é `servers`, não `mcpServers`:

```json
{
  "servers": {
    "dash-f2f": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp/dist/mcp/src/server.js"]
    }
  }
}
```

### Outra conta ou outro banco

Só nesse caso declare `env` na configuração — o que vem do ambiente sempre vence
o `.env.local`:

```json
{
  "command": "node",
  "args": ["/caminho/absoluto/mcp/dist/mcp/src/server.js"],
  "env": {
    "DATABASE_URL_MCP": "postgres://dash_f2f_reader:…",
    "DASH_F2F_OWNER_EMAIL": "outra.pessoa@f2f-digital.com"
  }
}
```

---

## 3. Usar

Depois de conectado, peça em linguagem natural. O agente escolhe a ferramenta:

| você pergunta | ferramenta |
|---|---|
| "quais sites estão no painel?" | `list_sites` |
| "o que está desatualizado em todos os sites?" | `list_outdated` |
| "me dá o inventário do doppio" | `get_site_status` |
| "o que mudou na última varredura?" | `diff_scans` |
| "quem tem WooCommerce instalado?" | `find_plugin` |
| "algum site parou de responder?" | `list_failing_sites` |
| "resumo geral do parque" | `fleet_summary` |
| "histórico do site X" | `get_scan_history` |
| "que temas estão instalados no site X?" | `get_site_themes` |
| "quantos administradores o site X tem?" | `get_site_users` |
| "a saúde do site X está boa?" | `get_site_health` |
| "algum site com Site Health crítico?" | `list_unhealthy_sites` |
| "o que mudou de usuário, tema ou configuração no site X?" | `get_recent_changes` |

---

## 4. Quando der errado

| mensagem | causa | solução |
|---|---|---|
| `DATABASE_URL_MCP ausente` | `npm run db:reader` nunca rodou, ou o `.env.local` está fora da árvore do projeto | rode `npm run db:reader` e confira a linha no `.env.local` |
| `DASH_F2F_OWNER_EMAIL ausente` | falta a linha no `.env.local` | adicione `DASH_F2F_OWNER_EMAIL=voce@f2f-digital.com` |
| `Nenhum usuário com e-mail … em app_users` | a conta nunca acessou o painel | entre uma vez em `/auth/sign-in` e reconecte |
| `O e-mail … não está num domínio permitido` | `DASH_F2F_OWNER_EMAIL` está fora de `ALLOWED_EMAIL_DOMAINS` | corrija o e-mail no `.env.local` |
| `Cannot find module …/server.js` | build ausente ou desatualizado | `npm run mcp:build` |
| `permission denied for table …` | a config está usando a `DATABASE_URL` do app, ou os grants sumiram | rode `npm run db:reader` de novo |
| servidor conecta mas `list_sites` volta vazio | nenhum site foi cadastrado ainda no painel (os dados são da equipe inteira, não de uma conta específica) | cadastre um site pela UI do painel |
| conector remoto responde `401` | token revogado, incompleto ou colado sem o `?token=` | gere outro em `/conectores` |
| conector remoto responde `503` | falta `DATABASE_URL_MCP` no ambiente de produção | adicione a variável na Vercel e faça deploy |

Depois de mexer em `mcp/src/**`, rode `npm run mcp:build` e reinicie o cliente —
ele carrega o build antigo até reiniciar.

Log do servidor sai em **stderr** (stdout é do protocolo). No Claude Code,
`/mcp` mostra o erro de inicialização quando o servidor não sobe.

---

## 5. O que o MCP pode e não pode

**Pode:** ler `app_users`, `sites`, `scans`, `scan_plugins`, `scan_themes`,
`scan_users`, `scan_settings`, `scan_health` e `scan_content` — o inventário
completo da **equipe inteira**, não só os sites que a conta configurada
cadastrou (`sql/011_shared_sites.sql`).

**Não pode**, por construção em três camadas:

1. escrever qualquer coisa — a role `dash_f2f_reader` só tem `GRANT SELECT`
   (teste automatizado cobre `INSERT`/`UPDATE`/`DELETE` recebendo
   `permission denied`);
2. rodar SQL do agente — as consultas são fixas e parametrizadas;
3. ler dados de fora do domínio permitido — a conta (via token remoto ou
   `DASH_F2F_OWNER_EMAIL` local) precisa estar num domínio de
   `ALLOWED_EMAIL_DOMAINS`, revalidado a cada uso; fora disso a conexão nem
   abre. Isso barra quem entra, não recorta o que as ferramentas devolvem —
   dentro do domínio permitido, todo token lê o mesmo inventário da equipe.

E nada nele fala com os sites WordPress: isso é trabalho do painel, também só com
`GET`.
