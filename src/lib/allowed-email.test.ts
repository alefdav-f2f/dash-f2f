import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAllowedEmail } from './allowed-email';

// Guarda e restaura ALLOWED_EMAIL_DOMAINS a cada teste para um teste não
// vazar configuração de env para o próximo.
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.ALLOWED_EMAIL_DOMAINS;
  delete process.env.ALLOWED_EMAIL_DOMAINS;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
  else process.env.ALLOWED_EMAIL_DOMAINS = originalEnv;
});

describe('isAllowedEmail — casos permitidos (default f2f-digital.com)', () => {
  it('aceita e-mail do domínio da agência', () => {
    expect(isAllowedEmail('alef@f2f-digital.com')).toBe(true);
  });

  it('é case-insensitive para o domínio', () => {
    expect(isAllowedEmail('ALEF@F2F-DIGITAL.COM')).toBe(true);
  });
});

describe('isAllowedEmail — bypasses clássicos de checagem de domínio', () => {
  it('rejeita domínio totalmente diferente', () => {
    expect(isAllowedEmail('x@evil.com')).toBe(false);
  });

  it('rejeita domínio-sufixo (derrota includes/endsWith mal feito)', () => {
    // "f2f-digital.com.evil.com" contém "f2f-digital.com" como substring e
    // termina com... não, mas um endsWith(‘f2f-digital.com’) ingênuo em cima
    // do endereço inteiro, ou um includes, cairia nessa armadilha.
    expect(isAllowedEmail('x@f2f-digital.com.evil.com')).toBe(false);
  });

  it('rejeita domínio colado por prefixo (derrota endsWith)', () => {
    expect(isAllowedEmail('x@evilf2f-digital.com')).toBe(false);
  });

  it('rejeita subdomínio — subdomínio não é o domínio (decisão deliberada)', () => {
    // Um subdomínio (ex.: sites de cliente hospedados sob *.f2f-digital.com,
    // ou um domínio comprometido que registra sub.f2f-digital.com em outro
    // DNS) não prova controle sobre f2f-digital.com. Se a agência um dia
    // quiser aceitar subdomínios, isso precisa ser uma decisão explícita e
    // testada — não um efeito colateral de comparação frouxa.
    expect(isAllowedEmail('x@sub.f2f-digital.com')).toBe(false);
  });

  it('rejeita múltiplos @ (domínio "de verdade" fica depois do segundo @)', () => {
    expect(isAllowedEmail('x@f2f-digital.com@evil.com')).toBe(false);
  });

  it('rejeita local-part entre aspas escondendo o domínio real', () => {
    // Sintaticamente isso seria um local-part cotado com "@" embutido, e o
    // domínio real seria evil.com. Não damos suporte a local-part cotado:
    // qualquer string com mais de um "@" é recusada, então isso cai no
    // mesmo caso do teste anterior — e do lado seguro (nunca aceita um
    // endereço que poderia não ser de f2f-digital.com).
    expect(isAllowedEmail('"x@f2f-digital.com"@evil.com')).toBe(false);
  });

  it('rejeita string vazia', () => {
    expect(isAllowedEmail('')).toBe(false);
  });

  it('rejeita null', () => {
    expect(isAllowedEmail(null)).toBe(false);
  });

  it('rejeita undefined', () => {
    expect(isAllowedEmail(undefined)).toBe(false);
  });

  it('rejeita string sem @', () => {
    expect(isAllowedEmail('no-at-sign')).toBe(false);
  });

  it('rejeita local-part vazio', () => {
    expect(isAllowedEmail('@f2f-digital.com')).toBe(false);
  });

  it('rejeita ponto final (forma FQDN) — comparação exata já recusa, decisão: não normalizar', () => {
    // "f2f-digital.com." (com ponto final) é uma forma FQDN válida em DNS,
    // mas não é igual, caractere a caractere, ao domínio configurado.
    // Decisão: não normalizar removendo o ponto final. Comparação exata
    // simplesmente recusa, sem lógica extra — menos código, menos chance de
    // introduzir um bug de normalização mais tarde.
    expect(isAllowedEmail('x@f2f-digital.com.')).toBe(false);
  });

  it('aceita e-mail com espaços nas pontas — decisão: aparar (trim) o envelope, não o conteúdo', () => {
    // Espaço no início/fim costuma vir de copiar e colar ou de um form que
    // não aparou o valor. Aparamos só as pontas da string inteira antes de
    // procurar o "@" — isso não afrouxa a checagem de domínio, que continua
    // sendo comparação exata depois do trim.
    expect(isAllowedEmail(' alef@f2f-digital.com ')).toBe(true);
  });
});

describe('isAllowedEmail — configuração via ALLOWED_EMAIL_DOMAINS', () => {
  it('sem a env var, usa exatamente f2f-digital.com como default', () => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    expect(isAllowedEmail('alef@f2f-digital.com')).toBe(true);
    expect(isAllowedEmail('alef@f2f.com.br')).toBe(false);
  });

  it('aceita lista separada por vírgula, cada domínio da lista funciona', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'f2f-digital.com,f2f.com.br';
    expect(isAllowedEmail('alef@f2f-digital.com')).toBe(true);
    expect(isAllowedEmail('alef@f2f.com.br')).toBe(true);
    expect(isAllowedEmail('alef@evil.com')).toBe(false);
  });

  it('tolera espaços em volta de cada domínio da lista', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = ' f2f-digital.com , f2f.com.br ';
    expect(isAllowedEmail('alef@f2f-digital.com')).toBe(true);
    expect(isAllowedEmail('alef@f2f.com.br')).toBe(true);
  });

  it('lista é case-insensitive tanto na env var quanto no e-mail', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'F2F-DIGITAL.COM';
    expect(isAllowedEmail('alef@f2f-digital.com')).toBe(true);
  });

  it('ALLOWED_EMAIL_DOMAINS vazia NUNCA vira "aceita todo mundo" — cai no default', () => {
    // O pior desfecho possível seria uma env var em branco (erro de deploy,
    // variável declarada mas não preenchida) abrir a porta pra qualquer
    // domínio. Decisão: string vazia (ou só vírgulas/espaços) é tratada como
    // "nenhum domínio válido configurado" e cai no mesmo default de quando a
    // env var não existe — nunca amplia o acesso, na pior hipótese mantém o
    // comportamento seguro conhecido (só f2f-digital.com).
    process.env.ALLOWED_EMAIL_DOMAINS = '';
    expect(isAllowedEmail('alef@f2f-digital.com')).toBe(true);
    expect(isAllowedEmail('alef@evil.com')).toBe(false);
    expect(isAllowedEmail('alef@qualquercoisa.com')).toBe(false);
  });

  it('ALLOWED_EMAIL_DOMAINS só com vírgulas/espaços também cai no default', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = ' , , ';
    expect(isAllowedEmail('alef@f2f-digital.com')).toBe(true);
    expect(isAllowedEmail('alef@evil.com')).toBe(false);
  });
});
