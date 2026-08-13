# Fase 1 — Autenticação, cadastro, isolamento por empresa e administração básica de usuários no Paperclip

## Objetivo

Implementar a primeira camada de multiusuário do Paperclip de forma segura, extensível e compatível com a arquitetura existente.

Esta fase deve permitir:

1. cadastro de usuário por e-mail e senha;
2. login por e-mail e senha;
3. login/cadastro com Google;
4. confirmação/validação de e-mail quando necessária;
5. recuperação de senha por código enviado por e-mail usando Resend;
6. cadastro de dados de pessoa física ou pessoa jurídica;
7. sessão autenticada e logout;
8. associação entre usuários e empresas;
9. isolamento real de dados por empresa no backend;
10. perfil de administrador global;
11. área administrativa mínima para gerenciar usuários, empresas e vínculos;
12. estrutura inicial de roles/memberships preparada para permissões futuras.

A implementação deve ser feita sem introduzir funcionalidades comerciais, cobrança ou integração com serviços de LLM.

---

# Regra principal

Após esta implementação:

```text
Usuário A -> Empresa A
Usuário B -> Empresa B
Administrador global -> todas as empresas
```

O Usuário A não pode visualizar, consultar, modificar ou executar qualquer recurso pertencente à Empresa B.

Essa proteção deve existir no **backend**, e não apenas no frontend.

---

# Escopo desta implementação

Implementar somente:

- autenticação por e-mail e senha;
- cadastro por e-mail e senha;
- autenticação/cadastro com Google;
- recuperação de senha por código enviado via Resend;
- confirmação de código de recuperação antes da troca de senha;
- dados cadastrais de pessoa física;
- dados cadastrais de pessoa jurídica e de seu responsável;
- sessão autenticada;
- logout;
- proteção de rotas privadas;
- associação entre usuários e empresas;
- isolamento de dados por empresa;
- perfil `SUPER_ADMIN`;
- roles iniciais de empresa;
- tela de login;
- tela de cadastro;
- tela de recuperação de senha;
- área administrativa mínima para usuários e empresas;
- criação, edição, bloqueio e desbloqueio de usuários;
- associação e remoção de usuários de empresas;
- redefinição administrativa de senha;
- autorização consistente no backend;
- migrations e testes necessários.

---

# Fora de escopo

**NÃO implementar nesta fase:**

- Stripe;
- pagamentos;
- assinatura;
- planos;
- créditos;
- cobrança;
- integração de créditos com 9Router;
- limites de empresa por plano;
- limites de agentes por plano;
- combos do 9Router;
- permissões granulares como `CREATE_AGENT`, `RUN_AGENT`, `CREATE_ISSUE`, etc.;
- MFA/2FA;
- outros provedores sociais além do Google;
- qualquer regra comercial futura.

Não criar abstrações complexas para funcionalidades que ainda não existem.

Entretanto, a modelagem desta fase **não deve bloquear crescimento futuro**.

---

# Etapa obrigatória antes de implementar

Antes de escrever código, investigue completamente a implementação atual do Paperclip.

Não assuma arquitetura, framework, ORM, sistema de sessão, sistema de autenticação ou estrutura de banco.

Localize e documente internamente antes de alterar:

- onde `Company` é definida;
- como Company é persistida;
- todas as principais entidades que pertencem a uma Company;
- como Agents são associados a Company;
- como Issues/Tasks são associados a Company;
- como Projects são associados a Company;
- como Runs são associados a Company;
- como Secrets são associados a Company;
- como Approvals são associados a Company;
- como Budgets são associados a Company;
- rotas de API relacionadas a Company;
- mecanismo atual de autenticação, se existir;
- middleware existente;
- contexto de request;
- ORM e migrations;
- padrão usado pelo projeto para services/repositories/controllers/routes;
- estrutura frontend;
- sistema de rotas frontend;
- mecanismo usado para state/session;
- componentes UI existentes reutilizáveis;
- testes existentes de autenticação/autorização/Company scope;
- qualquer integração de e-mail já existente;
- qualquer integração OAuth já existente;
- variáveis/secrets já usados para autenticação.

Antes de criar uma nova função, middleware, service ou helper, pesquise se já existe implementação equivalente ou parcialmente equivalente no projeto.

**Não duplicar lógica existente.**

Faça a menor alteração arquitetural possível que cumpra corretamente os requisitos.

---

# Modelo de domínio

A relação principal deve continuar sendo:

```text
User
  |
  +-- CompanyMembership -- Company
```

Não implementar o relacionamento colocando apenas `companyId` diretamente em `User`.

Precisamos suportar corretamente:

```text
1 usuário -> 1 ou mais empresas
1 empresa -> vários usuários
```

Mesmo que inicialmente a maioria dos usuários tenha acesso a uma única empresa.

## Separação obrigatória entre pessoa e empresa

Não colocar todos os dados de CNPJ e da empresa dentro da tabela `User`.

O usuário representa uma **pessoa física autenticável**. A empresa representa uma **pessoa jurídica/organização**.

Isso é necessário porque futuramente uma mesma empresa poderá possuir vários usuários.

Estrutura conceitual:

```text
User (pessoa/responsável)
  |
  +-- UserAddress
  |
  +-- CompanyMembership
          |
          +-- Company (empresa/pessoa jurídica)
                  |
                  +-- CompanyAddress
```

Os nomes exatos das entidades/tabelas devem seguir o padrão existente do Paperclip.

---

# Tipos de cadastro

A tela de cadastro deve permitir escolher entre:

```text
Pessoa Física
Pessoa Jurídica
```

O backend deve tratar os dois fluxos de forma explícita e validada.

---

# Entidade User

Criar ou adaptar a entidade de usuário conforme os padrões existentes do projeto.

Campos conceituais:

```text
User
- id
- fullName
- email
- passwordHash (nullable quando aplicável a conta criada exclusivamente via Google)
- cpf
- phone
- status
- isSuperAdmin
- emailVerifiedAt
- createdAt
- updatedAt
```

Se a stack/auth escolhida exigir campos adicionais, adicioná-los de forma consistente.

## CPF

- armazenar de maneira normalizada;
- validar formato/dígitos conforme padrão adotado;
- impedir duplicidade quando fizer sentido para a regra de identidade escolhida;
- não confiar apenas na máscara do frontend.

## E-mail

- deve ser único;
- deve ser normalizado;
- evitar duplicidade por diferença de maiúsculas/minúsculas;
- uma conta Google com o mesmo e-mail de uma conta existente deve seguir uma estratégia segura de vinculação, evitando contas duplicadas e account takeover.

## Telefone

- armazenar normalizado;
- máscara apenas na UI;
- validar no backend.

## Senha

Nunca armazenar senha em texto puro.

Usar algoritmo moderno apropriado de hashing, preferencialmente reutilizando o mecanismo já existente no projeto.

A senha nunca pode aparecer em:

- logs;
- respostas de API;
- banco em texto puro;
- telemetry;
- exceptions serializadas;
- objetos retornados ao frontend.

## Status

Implementar pelo menos:

```text
ACTIVE
BLOCKED
```

Usuário bloqueado não pode iniciar nova sessão nem continuar utilizando APIs autenticadas.

---

# Endereço do usuário/responsável

Modelar endereço de maneira estruturada, preferencialmente em entidade/tabela separada caso seja consistente com a arquitetura existente.

Campos conceituais:

```text
UserAddress
- id
- userId
- postalCode
- street
- number
- complement
- neighborhood
- city
- state
- country
- createdAt
- updatedAt
```

Não armazenar endereço inteiro em um único campo de texto se a base atual permitir modelagem estruturada.

---

# Company / dados de pessoa jurídica

Para cadastro como pessoa jurídica, a Company deve possuir dados cadastrais próprios.

Campos conceituais a adicionar/adaptar na entidade Company ou em um `CompanyProfile` equivalente:

```text
Company
- id
- name
- legalName (se aplicável)
- cnpj
- companyPhone
- createdAt
- updatedAt
```

Se `Company` já possuir `name` ou campos equivalentes, **reutilizar** e não duplicar.

## CNPJ

- armazenar normalizado;
- validar no backend;
- evitar duplicidade conforme regra do domínio;
- máscara somente na interface.

---

# Endereço da empresa

A empresa deve possuir endereço próprio, separado do endereço do responsável.

Campos conceituais:

```text
CompanyAddress
- id
- companyId
- postalCode
- street
- number
- complement
- neighborhood
- city
- state
- country
- createdAt
- updatedAt
```

O endereço da empresa e o endereço do responsável podem ser iguais, mas devem continuar semanticamente separados.

A UI pode oferecer opção semelhante a:

```text
[ ] Endereço da empresa é o mesmo do responsável
```

sem acoplar os dois registros de forma que uma alteração futura em um obrigatoriamente altere o outro.

---

# Cadastro de Pessoa Física

Fluxo mínimo:

```text
Criar conta
  -> escolher Pessoa Física
  -> nome completo
  -> CPF
  -> e-mail
  -> telefone
  -> endereço
  -> senha
  -> confirmar senha
  -> criar conta
  -> autenticar/confirmar e-mail conforme estratégia definida
  -> acessar somente a empresa/organização permitida
```

A forma exata de criação ou associação inicial da Company deve respeitar a lógica atual do Paperclip e o bootstrap definido nesta fase.

Não criar regras comerciais de quantidade de empresas.

---

# Cadastro de Pessoa Jurídica

Fluxo mínimo:

```text
Criar conta
  -> escolher Pessoa Jurídica

Dados da empresa:
  -> nome da empresa
  -> razão social, se aplicável
  -> CNPJ
  -> telefone da empresa
  -> endereço da empresa

Dados do responsável:
  -> nome completo
  -> CPF do responsável
  -> e-mail do responsável
  -> telefone do responsável
  -> endereço do responsável
  -> senha
  -> confirmar senha

  -> criar User do responsável
  -> criar/associar Company
  -> criar CompanyMembership como COMPANY_ADMIN
```

A criação deve ser transacional quando possível: não deixar usuário, empresa ou membership parcialmente criados em caso de falha.

---

# CompanyMembership

Criar uma entidade/tabela associativa equivalente a:

```text
CompanyMembership
- id
- userId
- companyId
- role
- createdAt
- updatedAt
```

Adicionar constraint de unicidade para:

```text
userId + companyId
```

---

# Roles iniciais

Implementar somente:

```text
COMPANY_ADMIN
COMPANY_MEMBER
```

`SUPER_ADMIN` deve ser autoridade global do usuário e não membership artificial em todas as empresas.

Exemplo:

```text
User.isSuperAdmin = true
```

Não implementar permissões granulares nesta fase.

---

# Métodos de autenticação

A aplicação deve suportar dois métodos:

```text
1. E-mail + senha
2. Google OAuth
```

A experiência de login deve apresentar ambos claramente.

---

# Login por e-mail e senha

Tela `/login` contendo no mínimo:

```text
E-mail
Senha
Entrar
Continuar com Google
Esqueci minha senha
Criar conta
```

Fluxo:

```text
/login
  -> usuário informa e-mail e senha
  -> backend valida credenciais
  -> backend valida status ACTIVE
  -> cria sessão segura
  -> redireciona para o Paperclip
```

Não introduzir JWT ou outra estratégia arbitrariamente se o projeto já possuir mecanismo adequado de sessão/autenticação.

Primeiro investigar e reutilizar padrões existentes.

---

# Login e cadastro com Google

Implementar autenticação com Google usando OAuth/OIDC de maneira compatível com a stack existente.

Fluxo conceitual:

```text
Continuar com Google
  -> redirecionar para Google
  -> usuário autoriza
  -> callback seguro
  -> validar identidade retornada pelo Google
  -> localizar usuário pelo vínculo do provider e/ou e-mail verificado
  -> criar ou vincular conta de forma segura
  -> validar status do usuário
  -> criar sessão
  -> acessar o Paperclip
```

## Regras importantes

- não confiar em dados arbitrários do frontend para identidade Google;
- validar callback/state/nonce conforme biblioteca/protocolo utilizado;
- não armazenar access token do Google se ele não for necessário;
- não criar contas duplicadas para o mesmo usuário apenas porque ele alternou entre senha e Google;
- não permitir account takeover apenas porque um e-mail coincide;
- reutilizar mecanismos consolidados da biblioteca/framework escolhido;
- credenciais OAuth devem vir de secrets/env, nunca hardcoded.

Campos/provider records adicionais podem ser criados se a solução de autenticação adotada exigir, por exemplo uma tabela de identidades externas.

Exemplo conceitual:

```text
UserIdentity
- id
- userId
- provider
- providerSubject
- providerEmail
- createdAt
```

Não criar essa tabela se a solução/auth library existente já tiver estrutura equivalente.

---

# Recuperação de senha com Resend

Implementar fluxo completo de **Esqueci minha senha** usando código temporário enviado por e-mail através do Resend.

Fluxo:

```text
/login
  -> Esqueci minha senha
  -> informar e-mail
  -> backend solicita recuperação
  -> gerar código temporário seguro
  -> enviar código pelo Resend
  -> usuário informa código
  -> backend valida código
  -> se válido, liberar definição de nova senha
  -> usuário informa nova senha + confirmação
  -> backend atualiza passwordHash
  -> invalidar código utilizado
  -> invalidar sessões anteriores quando aplicável
  -> permitir novo login
```

## Requisitos do código

O código de recuperação deve:

- ser gerado no backend;
- possuir expiração curta e configurável;
- ser de uso único;
- possuir limite de tentativas;
- não ser armazenado em texto puro quando puder ser armazenado de forma derivada/hash;
- ser invalidado depois do uso;
- ser invalidado após emissão de um novo código, conforme estratégia escolhida;
- possuir rate limit para impedir abuso;
- não aparecer em logs;
- não ser retornado pela API.

Estrutura conceitual, caso necessária:

```text
PasswordResetChallenge
- id
- userId
- codeHash
- expiresAt
- attempts
- consumedAt
- createdAt
```

Adaptar ao padrão da stack em vez de criar essa entidade se já houver mecanismo consolidado.

---

# Resend

Utilizar Resend apenas para entrega dos e-mails necessários desta fase.

Configuração deve ser feita por secrets/env, por exemplo de forma conceitual:

```text
RESEND_API_KEY
AUTH_EMAIL_FROM
```

Os nomes finais devem seguir o padrão do projeto.

Nunca incluir API key no código ou no repositório.

Criar uma abstração simples de envio de e-mail se o projeto ainda não possuir uma, evitando acoplar controllers/routes diretamente ao SDK do Resend.

Não criar um sistema genérico de notificações se ele não for necessário agora.

---

# E-mail de recuperação

Criar template coerente com a identidade visual da aplicação contendo no mínimo:

```text
Código de recuperação
Tempo de validade
Aviso para ignorar o e-mail caso a solicitação não tenha sido feita pelo usuário
```

Não incluir senha no e-mail.

---

# Confirmação/validação de e-mail

A arquitetura deve suportar `emailVerifiedAt`.

Para contas autenticadas via Google, utilizar a informação verificada pelo provider conforme a biblioteca/protocolo adotado.

Para contas criadas por e-mail/senha, implementar a verificação de e-mail se necessária ao fluxo escolhido, reutilizando o mesmo mecanismo seguro de challenges/códigos sempre que apropriado, sem duplicar lógica.

Se o Paperclip já tiver mecanismo equivalente, reutilizá-lo.

---

# Sessão

A sessão precisa permitir ao backend identificar de maneira confiável:

```text
userId
isSuperAdmin
```

As memberships e permissões devem ser consultadas/validadas pelo backend conforme necessário.

O frontend nunca deve ser fonte de verdade para:

```text
userId
companyId permitido
role
isSuperAdmin
```

---

# Rotas protegidas

Após a implementação, o Paperclip deve ser privado por padrão.

Usuários não autenticados não podem acessar a aplicação interna.

Comportamento esperado:

```text
rota privada frontend
  -> sem autenticação
  -> /login
```

API:

```text
401 Unauthorized
```

Rotas públicas devem ser apenas as necessárias, como:

```text
/login
/register
/forgot-password
/reset-password/código ou fluxo equivalente
OAuth callback do Google
endpoints necessários à autenticação
assets públicos
healthcheck necessário ao deployment
```

Não quebrar healthchecks nem endpoints técnicos internos necessários ao funcionamento do deployment.

---

# Regra de isolamento por empresa

Um usuário comum só pode acessar recursos de uma Company se existir uma `CompanyMembership` válida entre o usuário autenticado e aquela Company.

Conceitualmente:

```text
request
   |
   v
authenticatedUser
   |
   v
requestedCompanyId
   |
   v
isSuperAdmin?
   | yes
   +----------> allow
   |
   no
   v
CompanyMembership exists?
   | yes
   +----------> allow
   |
   no
   v
deny
```

---

# Backend primeiro

Não considerar a tarefa concluída apenas porque outras empresas desapareceram da interface.

O backend deve impedir acesso direto.

Exemplos:

```text
GET /api/companies/company-b
GET /api/companies/company-b/agents
PATCH /api/issues/:issueId
```

Se o recurso pertencer a outra empresa, o acesso deve ser negado.

---

# Evitar IDOR

Auditar endpoints contra **Insecure Direct Object Reference (IDOR)**.

Mesmo endpoints que recebem somente um `resourceId` devem descobrir a Company proprietária e confirmar a membership do usuário antes de retornar ou modificar o recurso.

Auditar no mínimo:

- Companies;
- Agents;
- Issues/Tasks;
- Projects;
- Runs;
- Agent Runs;
- Approvals;
- Secrets;
- Budgets;
- workspaces relacionados;
- configurações específicas de empresa;
- qualquer outro recurso company-scoped identificado durante a investigação.

---

# Estratégia de autorização

Centralizar autorização quando a arquitetura permitir, usando helpers/middleware equivalentes a:

```text
requireAuth()
requireSuperAdmin()
requireCompanyAccess(companyId)
requireCompanyAdmin(companyId)
```

ou abordagem idiomática equivalente.

Objetivos:

- consistência;
- baixo risco de endpoints esquecidos;
- facilidade de teste;
- extensão futura;
- mínimo acoplamento.

---

# SUPER_ADMIN

O administrador global deve acessar todas as Companies sem memberships individuais.

O `SUPER_ADMIN` deve poder:

- visualizar todos os usuários;
- visualizar todas as empresas;
- acessar todas as empresas;
- criar usuários;
- editar usuários;
- bloquear/desbloquear usuários;
- redefinir senha;
- vincular usuário a empresa;
- remover usuário de empresa;
- alterar role da membership;
- visualizar memberships;
- consultar os dados cadastrais necessários de usuários e empresas.

As rotas administrativas devem validar `SUPER_ADMIN` no backend.

---

# COMPANY_ADMIN e COMPANY_MEMBER

Nesta fase:

```text
COMPANY_ADMIN
COMPANY_MEMBER
```

são a estrutura inicial de autorização dentro da empresa.

Não implementar permissões granulares ainda.

`COMPANY_ADMIN` acessa sua empresa normalmente.

`COMPANY_MEMBER` pode possuir o mesmo acesso operacional básico nesta fase, exceto funcionalidades explicitamente administrativas existentes.

---

# Seleção de empresa

Se o usuário possui apenas uma CompanyMembership ativa:

```text
login
  -> abrir automaticamente a empresa permitida
```

Se possuir várias memberships, o seletor deve listar somente empresas autorizadas.

`SUPER_ADMIN` pode visualizar todas.

---

# Listagens

É proibido retornar todos os dados para depois filtrar no frontend.

Exemplo incorreto:

```text
GET /api/companies
-> todas
-> frontend filtra
```

Correto:

```text
GET /api/companies
-> backend identifica usuário
-> SUPER_ADMIN: todas
-> usuário comum: somente memberships autorizadas
```

Aplicar o mesmo princípio aos demais recursos company-scoped.

---

# Tela de login

Criar tela coerente com o design atual do Paperclip e reutilizar componentes existentes.

Deve conter:

```text
E-mail
Senha
Entrar
Continuar com Google
Esqueci minha senha
Criar conta
```

Estados mínimos:

```text
idle
loading
invalid credentials
blocked user
generic error
```

Mensagens de credenciais inválidas devem ser genéricas e não permitir enumeração desnecessária de usuários.

---

# Tela de cadastro

Criar tela/fluxo de cadastro com seleção inicial:

```text
Pessoa Física
Pessoa Jurídica
```

## Pessoa Física

Coletar:

```text
Nome completo
CPF
E-mail
Telefone
Endereço completo
Senha
Confirmar senha
```

## Pessoa Jurídica

Coletar:

```text
DADOS DA EMPRESA
Nome da empresa
Razão social, se aplicável
CNPJ
Telefone da empresa
Endereço da empresa

DADOS DO RESPONSÁVEL
Nome completo
CPF
E-mail
Telefone
Endereço do responsável
Senha
Confirmar senha
```

Aplicar máscaras somente como recurso visual. Toda validação necessária deve existir também no backend.

---

# Tela de recuperação de senha

Criar fluxo em etapas:

```text
1. Informar e-mail
2. Informar código recebido
3. Definir nova senha
4. Confirmação de sucesso
```

Não revelar se um determinado e-mail existe na base de maneira que facilite enumeração de contas.

---

# Logout

Logout deve invalidar a sessão efetivamente no mecanismo adotado e redirecionar para `/login`.

Não apenas limpar estado visual local.

---

# Área administrativa

Criar área protegida, seguindo o padrão de rotas existente, conceitualmente:

```text
/admin
/admin/users
/admin/companies
```

---

# Tela Admin — Usuários

Mostrar pelo menos:

```text
Nome completo
CPF
E-mail
Telefone
Status
Empresa(s)
Role(s)
Método(s) de autenticação
E-mail verificado
Criado em
```

Ações mínimas:

```text
Criar usuário
Editar usuário
Bloquear usuário
Desbloquear usuário
Redefinir senha
Adicionar vínculo com empresa
Remover vínculo com empresa
Alterar role da membership
```

Dados sensíveis de autenticação nunca devem ser exibidos.

---

# Tela Admin — Empresas

Mostrar pelo menos:

```text
Nome
CNPJ, quando aplicável
Telefone
Usuários vinculados
Quantidade de usuários
```

Ao abrir uma empresa, permitir visualizar suas memberships e os dados cadastrais necessários.

Não criar CRUD paralelo de Company se o Paperclip já tiver gerenciamento de empresas. Reutilizar o fluxo existente.

---

# Criação administrativa de usuário

O `SUPER_ADMIN` deve poder criar usuários manualmente.

Fluxo conceitual:

```text
SUPER_ADMIN
  -> Criar usuário
  -> dados pessoais
  -> e-mail
  -> telefone
  -> CPF
  -> senha inicial ou estratégia de ativação existente
  -> status
  -> empresa
  -> role
```

Não retornar `passwordHash`.

---

# Redefinição administrativa de senha

O `SUPER_ADMIN` pode definir nova senha para um usuário quando necessário.

A nova senha deve substituir o hash anterior e sessões antigas devem ser invalidadas quando a arquitetura suportar isso adequadamente.

Esse fluxo é independente do `Esqueci minha senha` via Resend.

---

# Bloqueio de usuário

Ao definir:

```text
status = BLOCKED
```

o usuário não pode:

- fazer novo login por senha;
- fazer novo login por Google;
- utilizar APIs autenticadas;
- continuar executando ações por sessão antiga.

---

# API `/me`

Criar ou reutilizar endpoint equivalente a:

```text
GET /api/me
```

Retornar apenas informações seguras necessárias ao frontend.

Exemplo conceitual:

```json
{
  "id": "...",
  "fullName": "...",
  "email": "...",
  "phone": "...",
  "status": "ACTIVE",
  "isSuperAdmin": false,
  "companies": [
    {
      "id": "...",
      "name": "...",
      "role": "COMPANY_ADMIN"
    }
  ]
}
```

Nunca retornar:

```text
passwordHash
reset code/hash
session secret
OAuth secrets/tokens desnecessários
credenciais internas
```

---

# Migrations

Criar migrations formais para todas as alterações necessárias.

Preservar dados atuais.

Não apagar Companies, Agents, Issues ou outros dados existentes.

A migration precisa considerar a instalação já em uso.

Definir estratégia segura para criar/promover o primeiro `SUPER_ADMIN`, preferencialmente usando padrão já existente no projeto, como:

1. environment variables;
2. seed controlado;
3. CLI/setup existente;
4. configuração explícita.

Não criar credenciais padrão inseguras hardcoded.

---

# Segurança

Aplicar boas práticas compatíveis com a stack existente.

No mínimo:

- password hashing seguro;
- session cookies seguros quando aplicável;
- `HttpOnly` quando aplicável;
- `Secure` em produção;
- `SameSite` adequado;
- proteção CSRF quando necessária;
- validação OAuth adequada (`state`, `nonce`, PKCE quando aplicável pela biblioteca);
- secrets do Google e Resend apenas por configuração segura;
- rate limit em login e recuperação de senha;
- códigos de recuperação temporários, expiráveis e de uso único;
- não expor `passwordHash`;
- não registrar senha ou código;
- autorização server-side;
- validação de input;
- impedir privilege escalation;
- impedir mass assignment de `isSuperAdmin`;
- impedir usuário comum de alterar própria role;
- impedir usuário comum de se adicionar a outra empresa;
- impedir IDOR;
- evitar enumeração de contas em login/recuperação;
- proteção contra contas duplicadas/account takeover ao vincular Google por e-mail.

---

# Variáveis/secrets esperados

Não hardcode valores. Adaptar nomes às convenções atuais do projeto.

Conceitualmente serão necessários:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI (se a biblioteca exigir configuração explícita)
RESEND_API_KEY
AUTH_EMAIL_FROM
APP_PUBLIC_URL / AUTH_BASE_URL equivalente, se necessário
```

Documentar no `.env.example` ou mecanismo equivalente **somente os nomes**, nunca valores reais.

---

# Testes obrigatórios

Adicionar testes seguindo a infraestrutura existente.

## Cadastro por e-mail/senha

Testar:

```text
cadastro PF válido
cadastro PJ válido
CPF inválido
CNPJ inválido
e-mail duplicado
campos obrigatórios
senha inválida conforme política adotada
criação transacional de PJ + responsável + membership
```

## Login por senha

Testar:

```text
login válido
senha inválida
usuário inexistente
usuário BLOCKED
logout
rota privada sem sessão
```

## Google

Testar conforme a capacidade da stack, mockando provider quando necessário:

```text
login Google válido
novo usuário Google
usuário Google existente
usuário BLOCKED via Google
evitar duplicação indevida de conta
falha de callback/state
```

## Recuperação de senha

Testar:

```text
solicitação de recuperação
código válido
código inválido
código expirado
código já consumido
limite de tentativas
emissão de novo código
nova senha atualizada
código não reutilizável
sessões antigas invalidadas quando aplicável
```

Não fazer testes reais dependentes de envio externo do Resend; mockar a camada de e-mail nos testes automatizados.

## Isolamento

Criar cenário:

```text
User A -> Company A
User B -> Company B
```

Testar que User A:

```text
pode listar Company A
não lista Company B
pode acessar Agent de Company A
não acessa Agent de Company B
pode acessar Issue de Company A
não acessa Issue de Company B
não consegue alterar recurso da Company B por ID direto
```

Aplicar testes equivalentes aos principais recursos company-scoped identificados na investigação.

## SUPER_ADMIN

Testar:

```text
pode listar todas as Companies
pode acessar Company A e B
pode listar usuários
pode criar/editar/bloquear usuário
pode gerenciar memberships
```

## Privilege escalation

Testar que usuário comum não consegue:

```text
promover a si mesmo para SUPER_ADMIN
alterar role arbitrariamente
se vincular a outra empresa
acessar /admin por API direta
manipular IDs para acessar dados alheios
```

---

# UX e responsividade

As telas novas devem seguir o design system e componentes já existentes do Paperclip.

Não criar uma segunda identidade visual.

As telas devem funcionar adequadamente em desktop e mobile.

Reutilizar:

- componentes;
- tipografia;
- cores;
- inputs;
- botões;
- dialogs;
- toasts;
- validações visuais;
- layout;
- tema claro/escuro, caso exista.

---

# Compatibilidade e não regressão

A implementação não pode quebrar:

- Companies existentes;
- Agents existentes;
- Issues/Tasks existentes;
- Projects;
- Runs;
- Secrets;
- Approvals;
- workspaces;
- healthchecks;
- deployment existente.

Antes de finalizar, executar os testes, lint, typecheck e build utilizados pelo projeto.

Corrigir regressões introduzidas pela implementação.

---

# Critérios de aceite

A tarefa só pode ser considerada concluída quando todos os pontos abaixo forem atendidos:

- [ ] existe cadastro por e-mail e senha;
- [ ] existe opção Pessoa Física/Pessoa Jurídica;
- [ ] dados PF são persistidos corretamente;
- [ ] dados PJ e do responsável são persistidos corretamente e de forma separada;
- [ ] existe login por e-mail e senha;
- [ ] existe login/cadastro com Google;
- [ ] contas Google e senha não são duplicadas/inseguramente vinculadas;
- [ ] existe `Esqueci minha senha`;
- [ ] código de recuperação é enviado via Resend;
- [ ] código possui expiração e uso único;
- [ ] código válido permite definir nova senha;
- [ ] usuário não autenticado não acessa a aplicação interna;
- [ ] logout invalida sessão;
- [ ] usuário BLOCKED não consegue autenticar nem usar sessão antiga;
- [ ] existe relacionamento User ↔ Company por membership;
- [ ] usuário comum vê somente suas Companies;
- [ ] isolamento é aplicado no backend;
- [ ] recursos por ID direto estão protegidos contra IDOR;
- [ ] `SUPER_ADMIN` possui acesso global;
- [ ] `/admin` e APIs administrativas exigem `SUPER_ADMIN`;
- [ ] existe administração básica de usuários e empresas;
- [ ] migrations preservam dados existentes;
- [ ] secrets Google/Resend não estão hardcoded;
- [ ] testes automatizados relevantes foram adicionados;
- [ ] lint/typecheck/build passam;
- [ ] nenhuma funcionalidade fora do escopo foi implementada.

---

# Entrega esperada da IA implementadora

Ao finalizar, apresentar um relatório objetivo contendo:

1. resumo da investigação inicial;
2. arquitetura de autenticação encontrada e decisão tomada;
3. arquivos alterados/criados;
4. migrations criadas;
5. modelo final de `User`, `Company`, endereços e `CompanyMembership`;
6. estratégia de login por senha;
7. estratégia de Google OAuth;
8. estratégia de recuperação via Resend;
9. como o isolamento por Company foi aplicado;
10. endpoints/rotas protegidos;
11. telas criadas;
12. testes adicionados e resultado;
13. variáveis de ambiente/secrets que precisam ser configurados;
14. comandos necessários para migration/build/deploy;
15. riscos ou pendências estritamente relacionadas a esta fase.

Não iniciar funcionalidades futuras.

Se durante a investigação for identificado que parte deste escopo já existe no Paperclip, **reutilizar e adaptar** em vez de recriar.
