# FEATURE FINAL — Paperclip deve consultar a API EXISTENTE do 9Router, sem acesso ao código do 9Router

## ESTA ESPECIFICAÇÃO SUBSTITUI TODAS AS VERSÕES ANTERIORES

Ignore qualquer `feature.md`, plano, análise ou instrução anterior que diga para:

- acessar o repositório do 9Router;
- alterar código do 9Router;
- instrumentar ingress/egress dentro do 9Router;
- criar endpoint novo no 9Router;
- criar `/api/combos/{combo}/capacity`;
- alterar runtime/error contract do 9Router;
- adicionar correlation id no 9Router;
- criar breaker no 9Router;
- pedir acesso ao código do 9Router para continuar.

**Nada disso faz parte desta tarefa.**

---

# Regra absoluta

> A implementação deve acontecer no Paperclip e em seu adapter/OpenCode.  
> O 9Router é uma dependência externa já pronta e deve ser usado SOMENTE através das APIs HTTP que ele já expõe.

## NÃO é necessário

```text
repo do 9Router
source code local do 9Router
clone do 9Router
editar imagem Docker do 9Router
alterar banco do 9Router
adicionar API ao 9Router
```

## É necessário somente

```text
Paperclip
   ↓ HTTP
http://9router:20128
```

ou o `baseURL` já configurado no provider atual.

O Paperclip já consegue chamar o 9Router para LLM.  
Portanto, a tarefa deve reutilizar essa conectividade de rede para consultar as APIs administrativas existentes.

---

# Objetivos

Implementar no Paperclip duas funcionalidades:

1. **Descobrir por que estão sendo enviados ~20k–32k tokens de input por chamada.**
2. **Consultar quota/reset do 9Router e pausar tasks quando não houver capacidade.**

Sem modificar o 9Router.

---

# APIs EXISTENTES que devem ser usadas

O 9Router atual já possui estas rotas HTTP:

```http
GET /api/combos
GET /api/providers
GET /api/usage/{connectionId}
GET /api/usage/request-logs
GET /api/usage/request-details
```

Também existem outras rotas em `/api/usage/*`, mas começar pelas acima.

---

# Contratos já confirmados

## 1. Combos

```http
GET /api/combos
```

Retorna conceitualmente:

```json
{
  "combos": [...]
}
```

Usar a resposta real da instância.

Essa rota serve para descobrir:

```text
nome do combo
models pertencentes ao combo
strategy
ordem/fallback
```

Não assumir detalhes do schema além do que for retornado.

---

## 2. Provider connections

```http
GET /api/providers
```

Lista as connections/providers cadastrados.

Usar para mapear:

```text
connectionId
provider
nome da connection
auth type
model/provider relacionado
```

Consumir somente os campos necessários.

NÃO persistir secrets ou tokens eventualmente presentes.

---

## 3. Usage/quota de uma connection

```http
GET /api/usage/{connectionId}
```

Essa rota consulta usage diretamente para a connection.

Exemplo:

```http
GET /api/usage/abc123
```

A resposta depende do provider.

Não criar schema rígido universal antes de consultar respostas reais de:

```text
Codex
Gemini
outros providers usados no combo
```

Precisamos normalizar essas respostas **dentro do Paperclip**.

---

## 4. Requisições recentes

```http
GET /api/usage/request-logs
```

O endpoint atual retorna as requisições recentes registradas pelo 9Router.

Usar isso para localizar as chamadas que no painel aparecem como:

```text
gpt-5.5    32.074 input
gpt-5.5    31.842 input
gpt-5.5    31.357 input
...
```

---

## 5. Request details

A rota correta atual é:

```http
GET /api/usage/request-details
```

NÃO usar:

```text
/api/usage/request-details/{id}
```

A rota atual recebe filtros via query string:

```text
page
pageSize
provider
model
connectionId
status
startDate
endDate
```

Exemplo:

```http
GET /api/usage/request-details?page=1&pageSize=100&model=gpt-5.5
```

Usar esses dados para investigar requests de ~30k tokens.

---

# PARTE A — executar primeiro: provar a origem dos 30k tokens

## Objetivo

Descobrir se:

```text
Paperclip/OpenCode
↓
já envia ~30k tokens
↓
9Router apenas recebe
```

Não precisamos medir ingress dentro do 9Router.

Vamos medir o payload **antes de sair do Paperclip/OpenCode** e comparar com o usage que o 9Router já registra.

---

# A1. Localizar o ponto exato de saída HTTP para o 9Router

Investigar SOMENTE o código do Paperclip/OpenCode.

Arquivos já conhecidos que podem participar:

```text
packages/adapters/opencode-9router/src/server/execute.ts
packages/adapters/opencode-local/src/server/execute.ts
packages/adapters/opencode-local/src/server/parse.ts
```

Localizar:

```text
onde a sessão OpenCode recebe baseURL do 9Router
onde o request é montado
onde messages/tools/history são enviados
```

---

# A2. Instrumentar SOMENTE o outbound do Paperclip/OpenCode

Imediatamente antes da chamada ao 9Router, registrar métricas.

Não registrar conteúdo completo.

Métricas desejadas:

```text
issueId
runId
agentId
sessionId
combo/model
messageCount
toolCount
totalCharacters
estimatedInputTokens
```

Breakdown, quando possível:

```text
system
agent instructions
current task
user/history
assistant/history
tool results
tool definitions
repository/file context
other
```

---

# A3. Encontrar a chamada correspondente no 9Router

Consultar:

```http
GET /api/usage/request-logs
```

e/ou:

```http
GET /api/usage/request-details?page=1&pageSize=100&model=gpt-5.5
```

Correlacionar usando dados existentes:

```text
timestamp
model
provider
connection
input tokens
output tokens
run start
run finish
```

Não modificar o 9Router para criar correlation id.

---

# A4. Comparação principal

Precisamos obter algo assim:

```text
Paperclip/OpenCode outbound estimate:
30.950 tokens

9Router usage:
31.123 input tokens
```

Conclusão:

```text
~30k já saíram do Paperclip/OpenCode.
```

Se acontecer:

```text
Paperclip/OpenCode outbound:
10.500

9Router usage:
31.000
```

não alterar o 9Router.

Apenas registrar:

```text
há diferença significativa que não pode ser explicada somente pelo Paperclip
```

e continuar a feature de quota separadamente.

Mas não solicitar acesso ao repo do 9Router.

---

# A5. Investigar crescimento de sessão

Agrupar chamadas por:

```text
agent
issue
run
sessionId
```

Procurar padrão:

```text
12k
18k
22k
27k
31k
```

Se existir, descobrir o que cresce:

```text
history
tool results
assistant responses
system context
tool schemas
repository context
```

---

# A6. Detectar mensagens grandes

Criar métricas por mensagem:

```text
index
role
type
characters
estimatedTokens
hash
```

Exemplo:

```text
msg 0 system        4.500
msg 1 user            800
msg 2 assistant       300
msg 3 tool          8.900
msg 4 tool          7.500
```

Isso deve revelar rapidamente tool results gigantes.

---

# A7. Detectar duplicação

Usar hash/fingerprint no payload outbound.

Detectar repetição de:

```text
AGENTS.md
HEARTBEAT.md
task description
system instructions
tool results
repository files
```

Não alterar conteúdo ainda.

Primeiro produzir diagnóstico.

---

# A8. Resultado obrigatório antes de otimizar tokens

Entregar:

```text
Issue:
Run:
Agent:
Session:
Trigger:

Paperclip/OpenCode outbound:
X tokens estimados

9Router reported input:
Y tokens

Diferença:
Z

Breakdown:
system:
history:
tools:
tool results:
task:
repository:
other:

Causa principal:
...

Arquivos/funções responsáveis:
...
```

Só então otimizar o lado Paperclip/OpenCode.

---

# PARTE B — consultar quota do 9Router usando API existente

## Regra

NÃO esperar que o 9Router retorne um novo contrato `capacity`.

O Paperclip deve construir uma visão normalizada usando:

```text
/api/combos
/api/providers
/api/usage/{connectionId}
```

---

# B1. Criar cliente HTTP do 9Router no Paperclip

Antes de criar classe nova, localizar integração existente que já consulta:

```text
/v1/models
```

e reaproveitar:

```text
base URL
timeouts
auth/config
HTTP client
error handling
```

Adicionar funções internas conceituais:

```ts
listNineRouterCombos()
listNineRouterConnections()
getNineRouterConnectionUsage(connectionId)
getNineRouterRequestLogs()
getNineRouterRequestDetails(filters)
```

Nomes finais devem seguir padrão do projeto.

---

# B2. NÃO solicitar acesso adicional ao 9Router

Executar chamadas diretamente contra a instância já configurada.

Exemplo dentro da mesma rede Docker:

```text
http://9router:20128/api/combos
http://9router:20128/api/providers
http://9router:20128/api/usage/request-logs
```

O host real deve vir da configuração existente, não ser hardcoded.

Se o `baseURL` configurado for:

```text
http://9router:20128/v1
```

derivar com segurança a management base:

```text
http://9router:20128
```

sem duplicar configuração se já houver helper.

---

# B3. Se alguma API exigir autenticação

Não pedir acesso ao código do 9Router.

Fazer:

1. executar a chamada;
2. observar status real;
3. se `401/403`, identificar qual autenticação o deployment atual já usa;
4. reutilizar credencial/config existente quando disponível;
5. documentar exatamente o bloqueio se a credencial não estiver exposta ao Paperclip.

**Um 401/403 da API não é motivo para pedir acesso ao repositório do 9Router.**

É um problema de autenticação HTTP entre serviços.

---

# B4. Descobrir o combo do agente

O agente utiliza, por exemplo:

```text
auto
dev
```

Resolver o combo configurado no adapter.

Consultar:

```http
GET /api/combos
```

Encontrar o combo pelo nome.

Extrair os membros reais.

---

# B5. Resolver connections relacionadas

Consultar:

```http
GET /api/providers
```

Mapear cada provider/model do combo para as connections reais.

Não hardcodar:

```text
Codex
Gemini
Claude
```

Funcionar com combos futuros.

---

# B6. Consultar quota de cada connection

Para cada connection elegível:

```http
GET /api/usage/{connectionId}
```

Capturar a resposta real.

Criar adapters/parsers SOMENTE no Paperclip para normalizar diferenças entre providers.

Exemplo conceitual interno:

```ts
type NormalizedQuotaState = {
  connectionId: string
  provider: string
  available: boolean | null
  exhausted: boolean
  resetAt: Date | null
  reason?: string
}
```

Não exigir que o 9Router devolva esse formato.

---

# B7. Como decidir capacidade do combo

Se existir pelo menos uma connection/model elegível com quota:

```text
comboAvailable = true
```

Exemplo:

```text
Codex  = exhausted
Gemini = available
```

Resultado:

```text
available
```

Não pausar.

Se todas as alternativas utilizáveis estiverem esgotadas:

```text
comboAvailable = false
```

---

# B8. Calcular retryAt

Usar reset/countdown retornado pelas APIs de usage.

Se:

```text
Codex reset = daqui 7 dias
Gemini reset = daqui 14 horas
```

então:

```text
retryAt = reset do Gemini
```

Usar:

```text
MIN(resetAt das alternativas que podem restaurar capacidade)
```

Não usar duração fixa.

---

# PARTE C — Pre-flight antes da chamada LLM

Antes de iniciar uma execução cara:

```text
Paperclip
↓
resolve combo
↓
consulta quota via APIs já existentes
↓
há capacidade?
```

## Se SIM

```text
executar normalmente
```

## Se NÃO

```text
não chamar LLM
não criar run cara
não deixar agente running
não gastar 30k tokens
persistir wait até retryAt
```

---

# PARTE D — Falha durante runtime

Existe race:

```text
pre-flight disponível
↓
execução inicia
↓
quota termina
↓
request falha
```

Não exigir mudança no erro do 9Router.

Quando ocorrer erro potencialmente relacionado a provider/quota:

```text
429
provider unavailable
quota-like failure
```

o Paperclip deve:

```text
1. consultar novamente /api/combos
2. consultar /api/providers
3. consultar /api/usage/{connectionId}
4. recalcular capacidade
```

Se API confirmar:

```text
todos esgotados
```

classificar internamente:

```text
provider_quota
```

e entrar no quota wait.

Se API mostrar que ainda há capacidade:

```text
não classificar como quota longa
```

seguir tratamento transitório existente.

Assim a API é fonte de confirmação e regex não é a fonte de verdade.

---

# PARTE E — Corrigir heartbeat

Arquivo principal:

```text
server/src/services/heartbeat.ts
```

Já foi identificado que:

```text
provider_quota
```

pode cair no mesmo fluxo de:

```text
transient_upstream
```

Isso deve ser separado.

---

# E1. provider_quota NÃO deve usar scheduled retry genérico

Não:

```text
provider_quota
↓
scheduleBoundedRetryForRun(...)
```

Fazer:

```text
provider_quota
↓
finalizar run
↓
agent idle
↓
liberar concurrency
↓
quota monitor persistido
```

---

# PARTE F — reutilizar infraestrutura existente

Já existem:

```text
scheduleProviderQuotaRecoveryMonitor(...)
monitorNextCheckAt
executionPolicy.monitor
PROVIDER_QUOTA_MONITOR_SERVICE_NAME
tickDueIssueMonitors(...)
dispatchClaimedIssueMonitor(...)
```

Usar isso.

Não criar scheduler novo.

---

# PARTE G — gate central

Enquanto:

```text
quota wait ativo
AND
monitorNextCheckAt > now
```

não iniciar nova run.

Todos os caminhos normais devem respeitar o gate:

```text
heartbeat
timer
comment
recovery
scheduled wake
scanner
worker
```

---

# PARTE H — retomada

Quando:

```text
retryAt <= now
```

não assumir que a quota voltou.

Consultar novamente:

```text
/api/combos
/api/providers
/api/usage/{connectionId}
```

## Se voltou

```text
liberar issue
scheduler normal executa
```

## Se não voltou

```text
calcular novo retryAt
atualizar monitor
continuar esperando
```

Sem LLM call.

---

# PARTE I — eliminar concorrência duplicada

Ao entrar em quota wait:

não podem coexistir:

```text
scheduled_retry
quota monitor
nova heartbeat run
```

Deduplicar/cancelar retry transitório relacionado.

---

# PARTE J — UI

Pode manter:

```text
issue.status = in_progress
```

se for a opção de menor risco.

Mas exibir estado derivado:

```text
Waiting for LLM quota
```

Mostrar:

```text
combo
retryAt
reason
```

Não mostrar:

```text
Running
```

sem run ativa.

---

# TESTES DE API — executar contra a instância REAL

Antes de codar parsers, testar pelo ambiente do Paperclip:

```bash
curl -sS http://9router:20128/api/combos
curl -sS http://9router:20128/api/providers
curl -sS http://9router:20128/api/usage/request-logs
curl -sS "http://9router:20128/api/usage/request-details?page=1&pageSize=20"
```

Depois:

```bash
curl -sS http://9router:20128/api/usage/<connectionId>
```

A URL deve ser derivada da config real.

Não copiar literalmente se o hostname configurado for outro.

---

# PRIMEIRO ENTREGÁVEL DA IA

Não responder:

```text
"preciso de acesso ao 9Router"
```

Não responder:

```text
"preciso do repo do 9Router"
```

Não responder:

```text
"precisa alterar endpoint do 9Router"
```

Executar as chamadas HTTP existentes.

Entregar:

```text
GET /api/combos
status:
schema observado:

GET /api/providers
status:
schema observado:

GET /api/usage/request-logs
status:
schema observado:

GET /api/usage/request-details
status:
schema observado:

GET /api/usage/{connectionId}
status:
schema observado:
campos de quota:
campos de reset:
```

---

# Se a chamada HTTP falhar

## Connection refused / DNS

Investigar:

```text
Docker network
baseURL existente
hostname já usado pelo adapter
```

Porque o Paperclip já acessa o 9Router para LLM.

Não pedir repo.

## 401/403

Investigar autenticação HTTP existente.

Não pedir repo.

## 404

Validar:

```text
base root vs /v1
versão do 9Router instalada
```

e testar as rotas equivalentes existentes.

Não pedir repo.

---

# Critérios de aceite

## Escopo

- [ ] zero mudança no 9Router;
- [ ] zero acesso ao repositório do 9Router necessário;
- [ ] zero endpoint novo;
- [ ] somente HTTP APIs existentes.

## APIs

- [ ] `/api/combos` consultado;
- [ ] `/api/providers` consultado;
- [ ] `/api/usage/{connectionId}` consultado;
- [ ] `/api/usage/request-logs` consultado;
- [ ] `/api/usage/request-details` consultado;
- [ ] schemas reais documentados.

## 30k tokens

- [ ] outbound do Paperclip/OpenCode medido;
- [ ] request equivalente encontrada no 9Router;
- [ ] valores comparados;
- [ ] categoria dominante do contexto identificada;
- [ ] sessão/histórico analisado;
- [ ] duplicação analisada.

## Quota

- [ ] combo resolvido;
- [ ] connections resolvidas;
- [ ] quota consultada;
- [ ] resetAt calculado a partir dos dados reais;
- [ ] pre-flight implementado;
- [ ] runtime failure revalida via API;
- [ ] provider_quota separado de retry transitório;
- [ ] run encerrada;
- [ ] agent/slot liberados;
- [ ] durable monitor reutilizado;
- [ ] gate impede wakes;
- [ ] retomada consulta API novamente.

---

# Resultado final esperado

```text
PAPERCLIP
    │
    ├── GET /api/combos
    ├── GET /api/providers
    └── GET /api/usage/{connectionId}
             │
             ▼
       capacity calculada
       NO PAPERCLIP
             │
       ┌─────┴─────┐
       │           │
 available      exhausted
       │           │
       ▼           ▼
 execute       quota wait
                   │
                retryAt
                   │
             agent idle
                   │
          consulta API depois
```

E para tokens:

```text
Paperclip/OpenCode outbound
          │
          ├── estimatedInputTokens = X
          │
          ▼
       9Router
          │
          └── /api/usage/request-details
              /api/usage/request-logs
                    │
                    ▼
             reportedInputTokens = Y

X ≈ Y
→ o contexto grande já veio do Paperclip/OpenCode.
```

---

# Instrução final

> Não há bloqueio por falta de acesso ao código do 9Router.

O 9Router deve ser tratado exatamente como qualquer serviço HTTP externo:

```text
conhecemos o host
conhecemos as rotas
fazemos GET
interpretamos JSON
implementamos a política no consumidor
```

Se existir qualquer problema, ele deve ser descrito como:

```text
erro HTTP
autenticação
rede
schema inesperado
```

e **nunca** como:

```text
"preciso acessar ou modificar o código do 9Router".
```
