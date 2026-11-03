# Prompt — políticas de prontidão operacional e execução revisada

Implemente no repositório `rafabarozzi/ai-reliability-platform` a evolução abaixo da Etapa 2. O frontend correspondente está em `rafabarozzi/aire-front`, nos arquivos `lib/aire/observability.ts`, `lib/server/observability-api.ts` e `components/aire/readiness-panel.tsx`. Leia esses arquivos antes de implementar: são a referência exata do contrato v1. Não altere o frontend silenciosamente; documente incompatibilidades e coordene qualquer mudança de contrato.

Trabalhe numa branch, preserve alterações existentes e abra PR com testes. Não faça deploy na Contabo, não dispare notificações reais nem crie monitores reais durante os testes. O desenvolvimento deve funcionar com fixtures sem trial Datadog.

## Objetivo de produto

O cliente configura suas próprias regras, ou escolhe decisão automática pelo motor. O framework BV fornecido serve como referência contextual, não como regra universal. A Etapa 2 deve avaliar cobertura, propor criação/ajuste de monitores, gerar texto de impacto, permitir revisão humana e executar apenas o conjunto aprovado. O relatório Markdown continua a documentação da jornada iniciada na Etapa 1.

O front agora tem:

- Visão geral separada de Jornadas; Observabilidade com lista pesquisável e avaliações das versões da jornada.
- Regras persistentes por organização, versionadas, com controle de concorrência e permissão `readiness:configure` (admin por padrão).
- Matriz automática/customizada; tags padrão e obrigatórias; política de resposta, escala existente e critérios de conclusão.
- Tags persistentes por jornada lógica, compartilhadas entre suas análises.
- Aprovação por recomendação, exceção de espera por monitor, confirmação distinta para ativar respostas.

Hoje o front bloqueia novas avaliações/aceites/execuções até o motor declarar suporte integral ao contrato. Leituras anteriores permanecem disponíveis. Depois que uma política é salva, a rota legada de mutação no front é bloqueada para evitar ignorar as regras novas. Não declare a capability prematuramente.

## API exata esperada

Manter autenticação de serviço, isolamento por tenant, ownership de análise/avaliação e cabeçalhos `X-AIRE-Actor` / `X-AIRE-Permissions`. Tenant nunca vem de um campo controlado pelo browser. Revalidar autorização no motor. Não encaminhar segredos em respostas, logs, relatórios ou prompts de IA.

### GET /v1/readiness/capabilities

```json
{
  "policyContract": 1,
  "modes": ["simulation"],
  "warRoomOverrides": true,
  "messageGeneration": true
}
```

Anunciar `real` somente com conectividade, credenciais e execução disponíveis. `messageGeneration` controla o editor de mensagem; a geração deve existir antes de anunciá-la. Responder 404/501 em instalações sem suporte faz o front manter as ações bloqueadas. Falha de conexão não equivale a suporte ausente. A capability é específica do tenant.

### POST /v1/readiness/analyses/{analysis_id}

O front envia somente este corpo:

```json
{
  "contract_version": 1,
  "mode": "simulation",
  "environment": "lab",
  "requested_by_user": true,
  "policy_context": { "revision": 1, "updatedAt": "ISO-8601", "policy": {} },
  "journey_tags": { "journey": "checkout", "team": "payments" }
}
```

`policy` deve seguir integralmente o schema do front, sem ignorar campos desconhecidos. `updatedAt` pode estar ausente na revisão zero. Tags e política vêm do armazenamento do BFF. O motor deriva bindings e contexto do artefato da Etapa 1; o front novo não envia `bindings` nem `scenario: commerce`. Se a identidade do serviço não puder ser confirmada, produzir gap explícito e bloquear ações dependentes. Não confundir tags desejadas nos monitores com evidência de tags existentes na telemetria.

Retornar avaliação com `id` UUID, `analysis` UUID, `created_at` ISO-8601, `state` e `data`, contendo `input.mode`, `policy_context` imutável, `findings`, `recommendations` e opcional `pause_reason`. A política capturada, revisão do mapeamento e evidências precisam ser preservadas para auditoria; mudanças posteriores da organização só afetam novas avaliações. Retomar usa o snapshot original.

### GET /v1/readiness/analyses/{analysis_id}

Manter retorno como array de avaliações, mais recentes primeiro; incluir campos acima. GET `/v1/readiness/{evaluation_id}` retorna a mesma estrutura com `analysis` obrigatório para validação de ownership. GET `.../{evaluation_id}/report` retorna Markdown. Preservar leitura de avaliações antigas sem política. O front consulta também versões anteriores de uma jornada lógica. Se a escala desse histórico exigir um endpoint agregado/paginado, propor e implementar coordenadamente sem trocar o array existente.

### Recomendações

Manter `id`, `version` (strings), `service`, `signal`, `action`, `proposal`, `before`, `prerequisites` (array), `accepted`, `execution`, `evidence_refs`, `severity`. Acrescentar:

```json
{
  "monitor_settings": {
    "waitSeconds": null,
    "warRoomEnabled": false,
    "message": "Texto proposto"
  }
}
```

`proposal.message` também pode fornecer a mensagem inicial. `null` em waitSeconds significa herdar a política; `0` significa imediato; inteiros entre 0 e 86400. Não usar `value or default` para resolver zero. Permitir 60, 300, 600 segundos e outros valores válidos. Preservar overrides aprovados em novas avaliações por identidade estável do monitor + tenant + jornada, não apenas UUID da avaliação. Nova recomendação começa com War Room desativada até revisão explícita.

### POST /v1/readiness/{evaluation_id}/accept

```json
{
  "contract_version": 1,
  "policy_revision": 1,
  "selections": [
    {
      "id": "rec-id",
      "version": "rec-version",
      "tags": ["journey:checkout", "team:payments"],
      "monitor_settings": {
        "waitSeconds": 60,
        "warRoomEnabled": true,
        "message": "Mensagem revisada"
      }
    }
  ]
}
```

Obrigatório validar: ownership, permissão approve, revisão e versão, ausência de pré-requisitos pendentes, tags necessárias, valores válidos, severidade elegível para War Room, destinos e capacidades reais. Não assumir que o BFF é a única defesa. Separar a tag no primeiro `:`; valores podem conter `:`. Rejeitar duplicatas/conflitos de chaves, payload excessivo e alteração de recomendação já aplicada. Associar aceitação ao ator e timestamp.

Retornar `{"approval_token":"opaque-token"}` além dos campos desejados. O token deve vincular no servidor (ou assinatura verificável) tenant, análise, avaliação, versões, conjunto exato de IDs, tags, mensagem e espera resolvida. Definir expiração e comportamento seguro de reenvio. Edição após aprovação exige novo aceite. Um token ausente bloqueia a execução no front. Token não deve ser uma credencial Datadog.

### POST /v1/readiness/{evaluation_id}/execute

```json
{
  "contract_version": 1,
  "recommendation_ids": ["rec-id"],
  "approval_token": "opaque-token",
  "enable_responses": false
}
```

Executar apenas a seleção exata aprovada. Revalidar token, versões, ownership, permissões, escopo e pré-condições. Implementar idempotência e controle de concorrência para retry, dois cliques, falha parcial e reinício. Não criar monitores duplicados. `enable_responses:false` permite criação/atualização de monitor, mas não aciona/ativa a nova automação de War Room. `true` autoriza apenas as respostas com `monitor_settings.warRoomEnabled:true`, elegíveis na política e suportadas pelos conectores; jamais outras ações por inferência. Reuso idempotente não pode ampliar enable_responses de false para true sem nova aprovação. Se resposta ainda não estiver implementada, rejeitar sua ativação explicitamente; não reportar sucesso fictício. Retornar estado consultável por item.

POST `.../{evaluation_id}/resume` recebe `{"contract_version":1}` e precisa manter o contexto capturado, sem ampliar orçamento silenciosamente.

## Políticas e severidade

Use `policySchema` do front como contrato:

- `version:1`, `mode:automatic|custom`, `rules`.
- Custom: 36 combinações de Gold/Silver/Bronze × Core/Supporting/Non-Blocking × errors/latency/traffic/saturation. Cada regra tem severidade base P1–P5 e `escalation:none|journey_blocked|customer_impact`, com `escalatedSeverity`.
- Aplicar condição de agravamento apenas com evidência confirmada. Base P2 com agravamento P1 não é escolha arbitrária da IA. Evidência insuficiente deve aparecer como pendência.
- Automático: decisão explicável baseada em impacto da jornada, papel do serviço, sinal, contexto e evidência. Versionar a política automática do motor e registrar justificativa/confiança; IA não deve variar severidades sem critérios auditáveis.
- Separar prioridade do monitor, severidade do incidente e regras de resposta/ITSM. Redline/Blueline são nomes BV e não devem ser obrigatórios. SLA e governança não se confundem com criticidade técnica.
- Não exigir que cliente mantenha templates. Motor gera query, limites fundamentados, mensagem, recuperação e frase de impacto com contexto da Etapa 1/2; IA pode apoiar conteúdo, sempre com validação determinística da sintaxe, escopo e capacidades do provedor. Não inventar perda de receita ou impacto confirmado. Não criar query com métrica inexistente. Se faltarem dados, pedir revisão/registrar gap.

## Tags

`tags.journeyKey` é configurável e obrigatória em todo monitor aprovado. `definitions:[{key,required,defaultValue}]` contém os campos adicionais. Valores ficam na jornada e são predefinidos/revisados antes da execução; cliente pode editá-los depois. Alterar preferências no portal não modifica monitores já existentes automaticamente. Manter tags existentes que não pertencem à automação; conflitos devem aparecer no diff. Tags não devem substituir indevidamente service/env em consultas.

## Resposta operacional

`response` inclui `warRoomEnabled`, severidades elegíveis, `defaultWaitSeconds`, timezone IANA, schedule always/window, dias ISO 1=segunda até 7=domingo, start/end HH:mm, outsideHours notify/fallback e fallback, equipe, referência/origem de escala, destinos de notificação/ITSM/sala, requiredChecks.

- Reutilizar escala existente (Datadog ou externa). O campo é referência, não uma escala completa mantida pelo front. Validar resolução/cobertura e informar gaps.
- Janela limita abertura de War Room; não suprimir notificações de monitor por causa dela. Janelas cruzando meia-noite pertencem ao dia de início; considerar DST e fuso. Fora da janela, notificar ou encaminhar fallback conforme política.
- Espera extra começa quando ocorre alerta elegível, distinta da janela de avaliação do monitor. Persistir deadline e identificador de evento. Antes de abrir sala, reconsultar se a falha persiste, elegibilidade, janela, recuperação e existência de incidente/sala correlata. Recuperação cancela espera. Repetições não criam novas salas nem reiniciam relógio inadvertidamente. Mudança de grupo/escopo de alerta deve ser tratada corretamente.
- Sem on-call/destino validado, resposta não está pronta. Não copiar handles, salas, tags ou contas BV.
- Planejar conectores Datadog primeiro; Dynatrace, ServiceNow/Jira, Teams/Slack têm disponibilidade explícita. A implementação de uma tela não equivale a conector funcional.

## Discovery e limites

Reutilizar conectores existentes; API Datadog/MCP podem complementar discovery, sempre com budgets por tenant/avaliação, paginação, cache com idade, backoff/jitter, Retry-After e pausa/retomada. Controlar custos da IA. Distinguir sem telemetria de sem permissão, consulta incompleta, ausência no período e identidade não confirmada. Simulação determinística deve cobrir tudo sem credenciais ou chamadas externas.

## Relatório e conclusão

Anexar a Etapa 2 ao Markdown contínuo da jornada: cobertura, gaps, evidências, limitações da consulta, política/revisão, regras aplicadas e justificativas, recomendações, aceites, tags, espera herdada/override, execução e falhas, escala/rota e prontidão das automações. `requiredChecks` define o que precisa de evidência para concluir. Não declarar pronto apenas por criar monitores. Histórico não deve ser sobrescrito por reavaliação.

## Testes e entrega

Testar isolamento de tenants e ownership, perfis, rejeição de política inválida, matriz automática/customizada e agravamento sem evidência, tags customizadas obrigatórias e retenção de tags existentes, null/zero/60/600, preservação de override por monitor, snapshot imutável, token adulterado/expirado/seleção alterada, replay/idempotência, falha parcial, recuperação antes do deadline, alertas repetidos, reinício do worker, janela/DST/fallback, notificação independente, capability ausente, simulação sem rede e fluxo completo contra fixtures compatíveis com o BFF.

Atualizar documentação de configuração/migração e exemplos de fixtures. Entregar PR com descrição concreta, testes executados e limitações reais. Não habilitar `policyContract:1` até o fluxo completo de simulação e as validações do contrato funcionarem. Para recursos de resposta não disponíveis, retornar erro explícito e manter o relatório como pendente.
