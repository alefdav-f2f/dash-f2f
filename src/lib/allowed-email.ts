// Portão de entrada do dashboard. dash-f2f guarda Application Password do
// WordPress de todo o parque de sites de clientes da agência, e Application
// Password nativa do WordPress não tem escopo de capacidade — quem entra tem
// acesso equivalente a admin em cada site monitorado. Depois que o painel virou
// ferramenta de equipe (todo usuário autenticado vê e gerencia todos os sites),
// esta função é o único portão entre "qualquer pessoa na internet" e essas
// credenciais.
//
// Por isso a regra é dura: o domínio do e-mail (tudo depois do ÚLTIMO "@",
// e só aceitamos exatamente um "@") tem que ser IGUAL, caractere a caractere
// e sem diferenciar maiúscula/minúscula, a um dos domínios permitidos.
// Nunca `endsWith`, nunca `includes`, nunca regex sem âncora nos dois lados —
// essas três formas de comparar domínio têm bypass conhecido:
//   - endsWith('f2f-digital.com')  → passa "evilf2f-digital.com" (colado)
//   - includes('f2f-digital.com')  → passa "f2f-digital.com.evil.com" (sufixo)
//   - regex sem ^ e $              → passa variações com lixo nas pontas
// Igualdade exata sobre o domínio inteiro não tem essa classe de bug.
//
// LIMITE IMPORTANTE, para quem for usar isto num fluxo de autenticação: esta
// função SÓ restringe quais strings de e-mail são aceitas. Ela não prova que
// quem está pedindo acesso é dono daquela caixa de entrada — qualquer um pode
// digitar "inventado@f2f-digital.com" num formulário de cadastro. Provar posse
// exige verificação de e-mail (link/código enviado à caixa), que é configuração
// do Neon Auth, não deste módulo. Sem verificação de e-mail ligada, trate esta
// checagem como "filtro de formato", não como autenticação de identidade.
//
// Módulo puro, sem I/O: precisa ser importável de Server Action, route handler
// e do helper de sessão sem depender de banco nem de 'server-only'.

const DEFAULT_ALLOWED_DOMAIN = 'f2f-digital.com';

/**
 * Lê e normaliza a lista de domínios permitidos a partir de
 * `ALLOWED_EMAIL_DOMAINS` (separada por vírgula, espaços tolerados).
 *
 * Decisão deliberada: se a env var não existir, OU existir mas resultar numa
 * lista vazia (string vazia, só vírgulas, só espaços), o resultado é o
 * default `['f2f-digital.com']` — nunca uma lista vazia. Uma lista vazia
 * combinada com `isAllowedEmail` comparando "algum item da lista" faria toda
 * comparação falhar, o que pareceria seguro à primeira vista, mas depender
 * disso é frágil: basta uma mudança futura na lógica de comparação (ex.: "se
 * a lista estiver vazia, não filtra") para transformar uma env var em branco
 * — erro comum de deploy — em "aceita qualquer domínio". Cair explicitamente
 * no default conhecido e seguro remove essa categoria inteira de erro.
 */
export function getAllowedEmailDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS;
  if (raw === undefined) return [DEFAULT_ALLOWED_DOMAIN];

  const domains = raw
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);

  return domains.length > 0 ? domains : [DEFAULT_ALLOWED_DOMAIN];
}

/**
 * Diz se `email` pode usar o dashboard: tem exatamente um "@" e o domínio
 * depois dele é igual, sem diferenciar maiúscula/minúscula, a um dos
 * domínios de `getAllowedEmailDomains()`.
 *
 * NÃO prova posse do endereço — ver comentário no topo do arquivo.
 *
 * Decisões de normalização, cada uma deliberada e coberta em teste:
 * - Espaços nas pontas da string inteira são aparados antes de qualquer
 *   checagem (copiar/colar e formulários costumam deixar sobra). O domínio
 *   em si continua exigindo igualdade exata — aparar as pontas não afrouxa
 *   a comparação.
 * - Subdomínio (`sub.f2f-digital.com`) é recusado. Subdomínio não é o
 *   domínio, e um agência poderia querer liberar isso um dia — mas como
 *   decisão explícita e testada, não como efeito colateral de comparação
 *   frouxa.
 * - Forma FQDN com ponto final (`f2f-digital.com.`) é recusada. Não
 *   normalizamos removendo o ponto: igualdade exata já recusa sozinha, sem
 *   precisar de lógica extra para um caso de uso praticamente inexistente em
 *   endereço de e-mail.
 * - Mais de um "@" é sempre recusado, incluindo o caso de local-part entre
 *   aspas escondendo um "@" a mais (`"x@f2f-digital.com"@evil.com`). Não há
 *   suporte a local-part cotado (RFC 5321) — o preço é recusar alguns
 *   endereços tecnicamente válidos e raríssimos na prática, e o ganho é nunca
 *   aceitar por engano um endereço cujo domínio real é outro.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (email === null || email === undefined) return false;

  const trimmed = email.trim();
  if (trimmed.length === 0) return false;

  const parts = trimmed.split('@');
  if (parts.length !== 2) return false;

  const [localPart, domain] = parts;
  if (localPart.length === 0 || domain.length === 0) return false;

  const domainLower = domain.toLowerCase();
  return getAllowedEmailDomains().some((allowed) => domainLower === allowed);
}
