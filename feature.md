# Implementar integração dinâmica entre Paperclip, OpenCode e 9Router

## Contexto

Este repositório é um fork do Paperclip.

Preciso implementar uma integração nativa e confiável com o 9Router, mantendo o OpenCode como runtime responsável por executar o agente, usar ferramentas, manipular arquivos, executar comandos e manter sessões.

A arquitetura final deve ser:

```text
Paperclip
    ↓
OpenCode local
    ↓
9Router
    ↓
Combo selecionado
    ↓
Claude / Codex / Gemini / GLM / outros provedores
```

O Paperclip não deve conhecer nem configurar diretamente Claude, Codex, Gemini ou qualquer modelo real existente dentro do 9Router.

A responsabilidade deve ser distribuída assim:

```text
Paperclip:
- seleciona um combo lógico;
- configura o agente;
- inicia o OpenCode;
- acompanha execução e sessão.

OpenCode:
- executa o agente;
- usa ferramentas;
- manipula o projeto;
- envia requisições ao gateway.

9Router:
- mantém provedores e contas;
- controla quotas;
- escolhe modelos;
- executa fallback;
- executa round-robin;
- roteia cada combo para as LLMs configuradas.
```

Exemplos de combos que podem existir:

```text
auto
dev
research
review
cheap
backend
frontend
```

Novos combos poderão ser criados a qualquer momento no 9Router.

O Paperclip deve descobrir automaticamente todos os combos atuais e futuros, sem exigir:

* alteração de `PAPERCLIP_OPENCODE_PROVIDERS`;
* cadastro manual de cada combo;
* alteração do `.env`;
* rebuild da imagem;
* redeploy do Paperclip;
* reinicialização do Paperclip.

---

# Objetivo principal

Criar uma integração chamada preferencialmente:

```text
9Router via OpenCode
```

Ou, caso o padrão arquitetural atual do Paperclip determine outro nome:

```text
OpenCode — 9Router Gateway
```

Essa integração deve:

1. Consultar o endpoint `/v1/models` do 9Router.
2. Identificar dinamicamente os registros cujo campo `owned_by` seja igual a `"combo"`.
3. Mostrar esses combos no seletor de modelo/combo do agente.
4. Permitir selecionar um combo diferente para cada agente.
5. Gerar dinamicamente a configuração temporária do OpenCode.
6. Executar o OpenCode usando o combo selecionado.
7. Atualizar automaticamente a lista quando novos combos forem criados.
8. Não exigir declaração manual dos combos em variáveis de ambiente.
9. Não expor a API key em logs, respostas de API ou arquivos temporários permanentes.
10. Preservar integralmente o funcionamento dos adapters existentes.

---

# Etapa obrigatória de investigação

Antes de implementar:

1. Inspecione a arquitetura atual dos adapters do Paperclip.
2. Localize o adapter `opencode-local`.
3. Analise principalmente:

```text
packages/adapters/opencode-local/
packages/adapters/opencode-local/src/
packages/adapters/opencode-local/src/server/
packages/adapters/opencode-local/src/server/models.ts
```

4. Localize:

   * registro dos adapters;
   * definição dos schemas de configuração;
   * listagem de modelos;
   * endpoint usado pelo frontend para buscar modelos;
   * validação do modelo;
   * teste de ambiente;
   * execução do comando `opencode`;
   * geração de configurações temporárias;
   * componentes do formulário de criação e edição de agentes.

5. Não assuma que esses caminhos continuam idênticos. Confirme no código atual antes de modificar.

6. Documente brevemente no relatório final:

   * arquivos encontrados;
   * fluxo atual;
   * pontos modificados;
   * motivo da abordagem escolhida.

---

# Decisão arquitetural

Não implemente um adapter que chame diretamente:

```http
POST /v1/chat/completions
```

Isso removeria ou duplicaria as capacidades agentic do OpenCode.

A integração deve reutilizar o runtime do `opencode-local`.

Use uma destas abordagens, em ordem de preferência:

## Opção A — novo adapter que reutiliza o runtime do OpenCode

Criar um adapter específico:

```text
opencode_9router
```

Nome de exibição:

```text
9Router via OpenCode
```

Extraia funções compartilhadas do `opencode-local` para evitar duplicação de:

* execução de processo;
* parsing do resultado;
* gerenciamento de sessão;
* montagem do prompt;
* heartbeat;
* tratamento de ferramentas;
* captura de custo e uso;
* timeout;
* working directory;
* permissões;
* validação do comando.

## Opção B — modo gateway dentro do opencode-local

Caso um novo adapter gere duplicação excessiva, adicione ao `opencode-local` um modo:

```text
providerMode: native | 9router
```

Quando `providerMode` for `9router`, habilite os campos e comportamentos descritos neste documento.

Escolha a opção que gere menor acoplamento e menor risco de regressão.

Não copie arquivos inteiros do adapter existente apenas para trocar o provider.

---

# Configuração necessária

A integração deve aceitar as seguintes configurações globais por variáveis de ambiente:

```env
NINEROUTER_BASE_URL=http://9router:20128/v1
NINEROUTER_API_KEY=chave-do-9router
NINEROUTER_DEFAULT_COMBO=auto
NINEROUTER_SMALL_COMBO=auto
NINEROUTER_MODELS_CACHE_TTL_SECONDS=60
```

Somente estas duas devem ser obrigatórias:

```env
NINEROUTER_BASE_URL
NINEROUTER_API_KEY
```

As demais devem ter valores padrão.

Também deve ser possível sobrescrever por agente:

```text
baseUrl
apiKeyEnv
combo
smallCombo
comboPrefix
modelsCacheTtlSeconds
```

Não armazene o valor real da chave no registro do agente por padrão.

Armazene apenas o nome da variável:

```json
{
  "apiKeyEnv": "NINEROUTER_API_KEY"
}
```

O runtime deve obter o segredo pelo ambiente:

```ts
process.env[apiKeyEnv]
```

Nunca envie o valor da chave para o frontend.

---

# Normalização da URL

Implemente uma função centralizada para normalizar a URL.

Os formatos abaixo devem funcionar:

```text
http://9router:20128
http://9router:20128/
http://9router:20128/v1
http://9router:20128/v1/
https://router.exemplo.com
https://router.exemplo.com/v1
```

A aplicação deve produzir exatamente um endpoint válido:

```text
{normalizedBaseUrl}/models
```

Não permita resultados incorretos como:

```text
/v1/v1/models
/models/models
```

Internamente, prefira armazenar a URL normalizada terminando em `/v1`, sem barra final:

```text
http://9router:20128/v1
```

---

# Descoberta dinâmica dos combos

Implemente um serviço semelhante a:

```ts
discover9RouterCombos(options)
```

O serviço deve executar:

```http
GET {baseUrl}/models
Authorization: Bearer {apiKey}
Accept: application/json
```

Formato esperado:

```json
{
  "object": "list",
  "data": [
    {
      "id": "auto",
      "object": "model",
      "owned_by": "combo"
    },
    {
      "id": "dev",
      "object": "model",
      "owned_by": "combo"
    },
    {
      "id": "openai/gpt-model",
      "object": "model",
      "owned_by": "openai"
    }
  ]
}
```

Por padrão, exiba apenas:

```ts
entry.owned_by === "combo"
```

Não tente identificar combos por nomes como:

```text
auto
dev
combo/
```

A fonte de verdade deve ser:

```json
"owned_by": "combo"
```

Preserve exatamente o valor de:

```ts
entry.id
```

Não remova prefixos, barras ou caracteres do ID.

Um combo pode ser retornado como:

```text
auto
```

ou:

```text
combo/auto
```

Use exatamente o ID devolvido pela API.

---

# Filtro opcional por prefixo

Permita configurar opcionalmente:

```env
NINEROUTER_COMBO_PREFIX=pc-
```

Quando preenchido, somente combos iniciados com esse prefixo devem aparecer.

Exemplo:

```text
pc-auto
pc-dev
pc-research
```

Quando estiver vazio ou ausente, todos os registros com `owned_by: "combo"` devem aparecer.

O prefixo não deve ser obrigatório.

---

# Formato exibido pelo Paperclip

No frontend, o usuário deve enxergar algo semelhante a:

```text
9Router — auto
9Router — dev
9Router — research
```

O valor salvo na configuração do agente deve ser o ID original:

```json
{
  "combo": "dev"
}
```

Não salve desnecessariamente:

```text
9router/dev
```

O prefixo do provider pertence à configuração interna do OpenCode.

---

# Geração dinâmica da configuração do OpenCode

O OpenCode exige que providers OpenAI-compatible tenham um mapa de modelos.

Esse mapa não será mantido no `.env`.

Ele deve ser gerado dinamicamente com base na resposta de `/v1/models`.

Exemplo interno:

```ts
const comboModels = Object.fromEntries(
  combos.map((combo) => [
    combo.id,
    {
      name: `9Router — ${combo.id}`,
    },
  ]),
);
```

Gere uma configuração temporária equivalente a:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "9router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "9Router",
      "options": {
        "baseURL": "http://9router:20128/v1",
        "apiKey": "{env:NINEROUTER_API_KEY}"
      },
      "models": {
        "auto": {
          "name": "9Router — auto"
        },
        "dev": {
          "name": "9Router — dev"
        }
      }
    }
  },
  "model": "9router/dev",
  "small_model": "9router/auto"
}
```

Use os nomes e propriedades compatíveis com a versão do OpenCode instalada no Paperclip.

Antes de implementar, confirme se a versão atual usa:

```json
{
  "provider": {}
}
```

ou:

```json
{
  "providers": {}
}
```

Também confirme se utiliza:

```text
npm
options.baseURL
options.apiKey
```

ou a estrutura equivalente da versão atual.

Não copie cegamente o exemplo.

---

# API key no OpenCode

A configuração temporária deve referenciar uma variável de ambiente:

```text
{env:NINEROUTER_API_KEY}
```

Ou outro nome definido em:

```text
apiKeyEnv
```

Ao iniciar o processo do OpenCode, garanta que essa variável esteja presente no ambiente filho.

Não escreva o segredo diretamente no JSON temporário.

Não registre o segredo em:

* logs;
* mensagens de erro;
* eventos;
* telemetry;
* banco;
* resposta da API;
* configuração retornada ao frontend.

---

# Modelo selecionado

Ao executar um agente com:

```json
{
  "combo": "dev"
}
```

o OpenCode deve receber:

```text
9router/dev
```

Se o ID retornado pelo 9Router for:

```text
combo/dev
```

o OpenCode deve receber:

```text
9router/combo/dev
```

O adapter não deve converter o combo em Claude, Codex ou qualquer modelo interno.

O payload enviado pelo OpenCode ao 9Router deve manter o ID do combo como modelo lógico.

A responsabilidade de escolher a LLM final permanece exclusivamente no 9Router.

---

# Combo padrão

Se nenhum combo estiver selecionado no agente:

1. Use `NINEROUTER_DEFAULT_COMBO`.
2. Caso não esteja configurado, tente o combo `auto`.
3. Caso `auto` não exista, selecione o primeiro combo retornado.
4. Mostre claramente no frontend qual combo será usado.
5. Persista a escolha quando o agente for salvo.

Nunca selecione silenciosamente uma LLM real.

---

# Small model

O OpenCode pode utilizar um modelo auxiliar.

Implemente:

```env
NINEROUTER_SMALL_COMBO=auto
```

Por agente:

```json
{
  "smallCombo": "auto"
}
```

O valor enviado ao OpenCode será:

```text
9router/auto
```

Caso `smallCombo` não seja configurado, utilize o mesmo combo principal.

Não use automaticamente modelos reais ou IDs hardcoded.

---

# Cache

Implemente cache da descoberta dos combos para evitar chamadas excessivas.

Requisitos:

```text
TTL padrão: 60 segundos
Cache key: baseUrl + apiKeyEnv + comboPrefix
```

Não use o valor da API key diretamente na chave do cache.

O cache deve:

* armazenar apenas metadados públicos dos combos;
* expirar automaticamente;
* ser invalidado quando a configuração mudar;
* permitir atualização manual pelo frontend;
* não impedir que novos combos apareçam sem redeploy.

Adicione uma ação:

```text
Atualizar combos
```

Essa ação deve ignorar o cache e consultar novamente `/v1/models`.

Ao abrir o seletor, se o cache estiver expirado, atualize automaticamente.

---

# Validação durante a execução

Antes de executar o agente:

1. Obtenha os combos disponíveis.
2. Verifique se o combo selecionado existe.
3. Caso exista, continue.
4. Caso não exista, faça uma segunda tentativa ignorando o cache.
5. Caso continue ausente, retorne erro claro.

Mensagem sugerida:

```text
O combo "dev" não foi encontrado no 9Router.

Verifique se:
- o combo ainda existe;
- a API key possui acesso;
- o endpoint /v1/models está disponível;
- o Paperclip está conectado à instância correta.

Combos disponíveis: auto, research, review.
```

Não apresente mensagem genérica como:

```text
Model unavailable
```

Não faça fallback silencioso para outro combo durante uma execução já configurada, a menos que exista uma opção explícita para isso.

O fallback entre LLMs internas é responsabilidade do próprio combo no 9Router.

---

# Teste de ambiente

O botão ou fluxo de teste da configuração deve verificar:

1. Existência da variável da API key.
2. Validade da URL.
3. Conectividade com `/v1/models`.
4. Status HTTP.
5. Formato JSON.
6. Existência de pelo menos um combo.
7. Existência do combo selecionado.
8. Existência do comando `opencode`.
9. Geração da configuração temporária.
10. Execução de uma chamada real pelo OpenCode.

Probe sugerido:

```text
Responda somente: hello
```

O teste deve usar o combo selecionado.

O resultado deve mostrar etapas como:

```text
✓ URL do 9Router válida
✓ API key configurada
✓ 4 combos encontrados
✓ Combo selecionado: dev
✓ OpenCode disponível
✓ Configuração temporária criada
✓ Probe executado com sucesso
```

Em caso de erro, informe a etapa exata.

---

# Tratamento de erros

Implemente mensagens específicas para:

## API key ausente

```text
A variável NINEROUTER_API_KEY não está configurada no ambiente do Paperclip.
```

## Não autorizado

HTTP `401` ou `403`:

```text
O 9Router rejeitou a API key configurada.
```

## Endpoint incorreto

HTTP `404`:

```text
O endpoint de modelos do 9Router não foi encontrado. Verifique a base URL e evite duplicar /v1.
```

## Indisponibilidade

HTTP `502`, `503` ou `504`:

```text
O 9Router está temporariamente indisponível.
```

## Timeout

```text
A consulta aos combos do 9Router excedeu o tempo limite.
```

## Resposta inválida

```text
O 9Router retornou uma resposta incompatível com o formato OpenAI /v1/models.
```

## Nenhum combo

```text
A conexão com o 9Router funcionou, mas nenhum combo foi encontrado.
```

Nunca inclua a API key na mensagem.

---

# Timeouts e retry

Para `/v1/models`:

```text
Timeout padrão: 10 segundos
Retry: 1 tentativa adicional
```

Faça retry somente em:

```text
timeout
429
502
503
504
falha temporária de conexão
```

Não faça retry automático em:

```text
400
401
403
404
```

Respeite `Retry-After` quando disponível, mas limite o tempo total para não travar o frontend.

---

# Frontend

Na criação e edição do agente, quando o adapter selecionado for a integração 9Router, mostre:

```text
Base URL
Variável da API key
Combo principal
Combo auxiliar
Prefixo opcional
Atualizar combos
Testar conexão
```

O seletor de combo deve:

* mostrar loading;
* mostrar erro de conexão;
* permitir tentar novamente;
* exibir a quantidade encontrada;
* permitir pesquisa;
* preservar o combo selecionado;
* avisar quando o combo salvo não existe mais;
* não exibir modelos reais por padrão;
* não exibir segredos.

Exemplo:

```text
Combo principal

[ dev                         ▼ ]

Disponíveis:
- auto
- dev
- research
- review

4 combos encontrados no 9Router.
```

Se um novo combo for criado no 9Router, clicar em `Atualizar combos` deve fazê-lo aparecer imediatamente.

---

# Endpoint interno do Paperclip

Crie ou adapte um endpoint para descoberta dinâmica.

Exemplo conceitual:

```http
GET /api/adapters/opencode_9router/models
```

Ou siga o padrão já existente no repositório.

Parâmetros permitidos:

```text
baseUrl
apiKeyEnv
comboPrefix
forceRefresh
```

O servidor deve ler a API key do próprio ambiente.

O frontend nunca deve enviar o segredo.

Resposta sugerida:

```json
{
  "provider": "9router",
  "models": [
    {
      "id": "auto",
      "name": "9Router — auto",
      "ownedBy": "combo"
    },
    {
      "id": "dev",
      "name": "9Router — dev",
      "ownedBy": "combo"
    }
  ],
  "cached": false,
  "fetchedAt": "2026-08-04T19:00:00.000Z"
}
```

Use os tipos e contratos existentes no Paperclip quando possível.

---

# Compatibilidade com Docker

O seguinte endereço deve funcionar quando os serviços estiverem na mesma rede Docker:

```env
NINEROUTER_BASE_URL=http://9router:20128/v1
```

Também deve funcionar usando domínio externo:

```env
NINEROUTER_BASE_URL=https://router.exemplo.com/v1
```

Não use `localhost` como valor padrão em produção.

Documente que, dentro de um contêiner, `localhost` aponta para o próprio Paperclip.

---

# Compatibilidade retroativa

Não quebre:

* `opencode_local`;
* Claude Code;
* Codex;
* adapters externos;
* agentes já existentes;
* configurações existentes;
* descoberta atual de modelos;
* execução atual do OpenCode.

Se for necessário alterar tipos compartilhados, mantenha os campos antigos opcionais e compatíveis.

Não altere o comportamento do `opencode_local` quando o modo 9Router não estiver habilitado.

---

# Testes unitários obrigatórios

Adicione testes para:

1. Normalização de URL sem `/v1`.
2. Normalização de URL com `/v1`.
3. Remoção de barra final.
4. Prevenção de `/v1/v1`.
5. Parsing de resposta válida.
6. Filtro por `owned_by === "combo"`.
7. Preservação do ID original.
8. Prefixo opcional.
9. Ausência de prefixo.
10. API key ausente.
11. HTTP 401.
12. HTTP 403.
13. HTTP 404.
14. HTTP 429 com retry.
15. HTTP 503 com retry.
16. Timeout.
17. JSON inválido.
18. `data` ausente.
19. Nenhum combo encontrado.
20. Cache válido.
21. Cache expirado.
22. Force refresh.
23. Invalidação ao trocar a URL.
24. Invalidação ao trocar `apiKeyEnv`.
25. Geração do mapa dinâmico de modelos.
26. Seleção do combo principal.
27. Seleção do small combo.
28. Combo com barra no ID.
29. Segredo não presente nos logs.
30. Combo removido depois de salvo.

Use mock server ou mock de `fetch`.

Não faça testes dependentes de uma instância pública do 9Router.

---

# Testes de integração obrigatórios

Implemente um servidor fake OpenAI-compatible para simular o 9Router.

Cenário inicial:

```json
{
  "data": [
    {
      "id": "auto",
      "owned_by": "combo"
    },
    {
      "id": "dev",
      "owned_by": "combo"
    },
    {
      "id": "openai/gpt-test",
      "owned_by": "openai"
    }
  ]
}
```

Valide que o Paperclip mostra somente:

```text
auto
dev
```

Depois altere a resposta do fake server e adicione:

```json
{
  "id": "research",
  "owned_by": "combo"
}
```

Force a atualização e valide que aparece:

```text
auto
dev
research
```

Sem:

* alterar `.env`;
* reiniciar servidor;
* rebuild;
* redeploy.

---

# Teste end-to-end desejado

Quando possível, crie um teste ou script manual reproduzível:

```bash
export NINEROUTER_BASE_URL=http://localhost:20128/v1
export NINEROUTER_API_KEY=test-key
export NINEROUTER_DEFAULT_COMBO=auto
```

Fluxo:

1. Iniciar Paperclip.
2. Abrir criação de agente.
3. Selecionar `9Router via OpenCode`.
4. Ver combos `auto` e `dev`.
5. Selecionar `dev`.
6. Salvar.
7. Executar teste do adapter.
8. Confirmar que o OpenCode recebeu `9router/dev`.
9. Criar combo `research` no mock.
10. Atualizar a lista.
11. Confirmar que `research` aparece sem reiniciar o Paperclip.

---

# Logs

Adicione logs estruturados para:

```text
9Router model discovery started
9Router combos discovered
9Router combos loaded from cache
9Router combo validation started
9Router temporary OpenCode config created
OpenCode execution started with 9Router combo
```

Campos permitidos:

```text
baseUrl sem credenciais
combo
comboCount
cached
durationMs
statusCode
```

Campos proibidos:

```text
apiKey
Authorization
configuração completa contendo segredo
headers completos
```

Exemplo:

```json
{
  "service": "9router-model-discovery",
  "comboCount": 4,
  "cached": false,
  "durationMs": 182
}
```

---

# Arquivos temporários

Se uma configuração temporária do OpenCode for criada:

* use diretório temporário seguro;
* defina permissões restritas;
* remova após a execução;
* não inclua a API key real;
* reutilize o mecanismo temporário já existente no adapter OpenCode;
* garanta limpeza também em erros e cancelamentos;
* use `try/finally`.

---

# Documentação

Adicione documentação contendo:

## Exemplo mínimo

```env
NINEROUTER_BASE_URL=http://9router:20128/v1
NINEROUTER_API_KEY=nr_xxxxxxxxx
NINEROUTER_DEFAULT_COMBO=auto
```

## Exemplo Docker

```yaml
services:
  paperclip:
    environment:
      NINEROUTER_BASE_URL: http://9router:20128/v1
      NINEROUTER_API_KEY: ${NINEROUTER_API_KEY}
      NINEROUTER_DEFAULT_COMBO: auto
```

## Responsabilidades

```text
Paperclip seleciona o combo.
OpenCode executa o agente.
9Router escolhe e alterna entre as LLMs.
```

## Criação de novos combos

Explique que, após criar um novo combo no 9Router:

1. Abra a configuração do agente.
2. Clique em `Atualizar combos`.
3. Selecione o novo combo.

Nenhuma alteração no `.env` ou redeploy deve ser necessária.

---

# Critérios de aceite

A implementação somente estará concluída quando todos estes critérios forem atendidos:

* [ ] Existe uma integração clara com 9Router através do OpenCode.
* [ ] O Paperclip consulta `/v1/models`.
* [ ] Apenas registros com `owned_by: "combo"` aparecem por padrão.
* [ ] Todos os combos existentes são descobertos.
* [ ] Novos combos aparecem sem redeploy.
* [ ] Não existe lista hardcoded de `auto`, `dev` ou outros combos.
* [ ] Não é necessário usar `PAPERCLIP_OPENCODE_PROVIDERS`.
* [ ] Cada agente pode escolher um combo diferente.
* [ ] O ID original do combo é preservado.
* [ ] O OpenCode recebe `9router/<combo-id>`.
* [ ] O 9Router continua responsável pela LLM real.
* [ ] O Paperclip não precisa saber se o combo usa Claude, Codex ou outra LLM.
* [ ] A API key não é enviada ao frontend.
* [ ] A API key não aparece em logs.
* [ ] Existe cache com atualização manual.
* [ ] Existe retry controlado.
* [ ] Existem mensagens de erro específicas.
* [ ] O adapter atual do OpenCode continua funcionando.
* [ ] Os testes unitários passam.
* [ ] Os testes de integração passam.
* [ ] Build, lint e typecheck passam.
* [ ] A documentação foi adicionada.

---

# Restrições

Não faça:

* lista fixa de combos;
* hardcode de `auto`, `dev`, `claude` ou `codex`;
* chamada direta à LLM ignorando o OpenCode;
* armazenamento de API key no frontend;
* armazenamento da chave em texto puro no banco;
* exposição do segredo em logs;
* fallback silencioso para uma LLM;
* alteração que obrigue redeploy ao criar combo;
* duplicação completa do adapter `opencode-local`;
* mudanças fora do escopo sem justificativa;
* remoção de compatibilidade existente.

---

# Processo de implementação

Execute nesta ordem:

1. Investigue a arquitetura atual.
2. Apresente um plano curto baseado nos arquivos reais encontrados.
3. Implemente a camada de configuração.
4. Implemente o cliente do `/v1/models`.
5. Implemente parsing, filtro, cache e retry.
6. Integre com a descoberta de modelos do Paperclip.
7. Gere a configuração dinâmica do OpenCode.
8. Integre com execução e teste de ambiente.
9. Implemente o frontend.
10. Adicione testes unitários.
11. Adicione testes de integração.
12. Execute:

    * lint;
    * typecheck;
    * testes;
    * build.
13. Corrija todas as falhas.
14. Atualize a documentação.
15. Entregue o relatório final.

---

# Formato obrigatório da entrega

Ao finalizar, apresente:

## 1. Diagnóstico da arquitetura existente

Descreva como o Paperclip descobria e validava modelos antes da alteração.

## 2. Decisão arquitetural

Explique se foi criado um novo adapter ou um modo dentro do `opencode-local`.

## 3. Arquivos modificados

Liste cada arquivo e sua responsabilidade.

## 4. Fluxo final

```text
Agent configuration
→ fetch 9Router combos
→ select combo
→ generate OpenCode provider config
→ run OpenCode
→ OpenCode sends combo to 9Router
→ 9Router selects available LLM
```

## 5. Variáveis de ambiente

Mostre apenas nomes e exemplos mascarados.

## 6. Testes executados

Informe os comandos e resultados reais.

## 7. Evidências

Mostre:

* resposta simulada ou real de `/v1/models`;
* combos descobertos;
* configuração temporária sem segredos;
* comando/modelo usado pelo OpenCode;
* confirmação de que um combo novo apareceu sem redeploy.

## 8. Limitações restantes

Não esconda limitações, testes não executados ou riscos pendentes.

Comece agora analisando o código atual. Não implemente com base apenas neste documento sem primeiro conferir a arquitetura real do repositório.
