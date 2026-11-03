# Etapa 2: cadastros e fluxo de aprovação

Implementação do front em novembro de 2026. A main do motor consultada foi `85490f3c980edc60df4a9b1f937ecbdcc295e624`; ela oferece contrato v1 em simulação e **não implementa esta extensão**. Não ativar a capability apenas para liberar a interface.

## Entrega no front

- Menu de repositório fecha ao clicar/focar fora e com Escape.
- Repositório e revisão validados automaticamente após 500 ms; respostas atrasadas são ignoradas. Repetição manual fica apenas na recuperação de erro.
- A opção de refazer só aparece se o histórico da organização contém resultado concluído para a mesma identidade de jornada, revisão e tier.
- Matriz: Serviço | Sinal | Severidade. O editor salva regras sem agravamento; registros históricos ficam preservados.
- Tags da organização definem nomes e obrigatoriedade. Valores por jornada; novos formulários usam a política atual, aprovação usa o snapshot da avaliação. Nenhum valor padrão novo é gravado.
- Cadastros operacionais: equipes, equipes sempre acionadas em WR, janelas com dias/fuso e horários que cruzam meia-noite, salas Teams/Slack ou referência de automação, rotas tag/valor → sala e destino padrão.
- Cadastros e preferências com isolamento por organização, revisão otimista, arquivo atômico e histórico. Exclusão de sala referenciada é impedida. Exclusão de equipe/janela exige nova seleção no próximo uso; snapshots existentes permanecem válidos.
- Início da avaliação: tags, equipe, cadastro de equipe no próprio fluxo e botão Iniciar avaliação. Não há seletor de modo nem ambiente lab predefinido.
- Ambiente resolvido pelo BFF: tag `env` preenchida, depois ambiente de avaliação no cadastro organizacional. Sem valor, erro acionável, sem inferir produção.
- Aprovação: escala/on-call, destino de notificações, ITSM, janela de notificações e janela de WR independentes. Aplicação em lote aos monitores selecionados; espera herdada/null, imediata/0 ou exceção por monitor continua disponível.

## Contrato proposto ao motor (precisa implementar e homologar)

Manter `policyContract: 1`, `warRoomOverrides`, `messageGeneration`, `modes`. Acrescentar `operationalCatalog: true` **somente após suportar os campos abaixo**. O front exige essa capability e `modes` contendo `real` para iniciar a avaliação simplificada. Nunca converte a avaliação em simulação silenciosamente. Históricos simulados continuam identificados.

Se a leitura de telemetria real vier em uma capability separada de escrita, alinhar esse campo com o front antes do merge: `modes: ["real"]` não deve liberar escrita sem aprovação. Credenciais Datadog cadastradas não bastam para anunciar suporte.

### Criar avaliação

O BFF preserva o POST `/v1/readiness/analyses/{analysisId}` e acrescenta:

```json
{
  "contract_version": 1,
  "requested_by_user": true,
  "mode": "real",
  "environment": "production",
  "policy_context": { "revision": 3, "policy": "política existente" },
  "journey_tags": { "jornada": "checkout", "bu": "varejo" },
  "operational_context": {
    "revision": 2,
    "teamId": "UUID da equipe responsável",
    "catalog": {
      "evaluationEnvironment": "production",
      "teams": [{ "id": "UUID", "name": "Commerce" }],
      "alwaysTeamIds": ["UUID ERT"],
      "windows": [{ "id": "UUID", "name": "Comercial", "timezone": "America/Sao_Paulo", "days": [1,2,3,4,5], "start": "08:00", "end": "18:00" }],
      "destinations": [{ "id": "UUID", "name": "Varejo", "provider": "teams", "kind": "room", "reference": "referência sem credencial" }],
      "routes": [{ "id": "UUID", "key": "bu", "value": "varejo", "destinationId": "UUID" }],
      "defaultDestinationId": null
    }
  }
}
```

Persistir snapshot imutável em `evaluation.data.operational_context` e devolver em GET/histórico. Validar referências, limites e tenant antes da execução; o schema completo está em `lib/aire/operational-catalog.ts`. A política organizacional pode habilitar WR sem preencher equipe, escala e sala globais: esses vínculos passam a ser validados na aprovação por monitor. Não usar campos globais vazios como destino.

### Aprovar monitores

Cada seleção continua tendo id, version, tags (lista `chave:valor`) e monitor_settings. Acrescenta `response_context` quando o usuário personaliza a resposta:

- catalogRevision;
- team `{id,name}`;
- additionalTeams (sem repetir a equipe responsável);
- destination `{id,name,provider,kind,reference}` ou null;
- onCallProvider (`datadog`/`external`), onCallReference;
- notificationTarget, itsmTarget;
- notificationWindowId, warRoomWindowId;
- notificationWindow, warRoomWindow (snapshot completo ou null=24x7).

A resolução usa o **snapshot da avaliação**, não o cadastro atual. Rotas com várias correspondências para a mesma sala são válidas. Correspondências para salas diferentes bloqueiam; nenhuma correspondência usa destino padrão, ou exige ajuste se WR ativada. Não escolher arbitrariamente a primeira rota.

Validar esses campos na aprovação, inclusive escala/sala quando WR ativada. Incluir todo o contexto no hash/token de aprovação; qualquer mudança invalida autorização. Não ignorar campos desconhecidos. Revalidar a falha após a espera antes de acionar WR. Aplicar calendário/fuso de abertura sem silenciar notificações. Definir comportamento fora da janela explicitamente. Respeitar severidades elegíveis e equipes adicionais somente ao acionar WR.

Manter deduplicação, retomada, auditoria e confirmação `enable_responses` separada da criação dos monitores. A referência de automação deve ser resolvida por integração confiável configurada no servidor, nunca fazer HTTP arbitrário baseado num texto fornecido pelo cliente.

## Verificações necessárias no backend

1. Catálogo de outro tenant nunca pode ser consultado/usado.
2. Alterar ou excluir catálogo depois da avaliação não muda o snapshot aprovado.
3. Espera null/0/60/600 tem semânticas distintas; recuperação cancela WR.
4. Janela noturna, timezone, finais de semana e notificações independentes.
5. Tags jornada/bu, conflitos de rota, destino padrão e ausência de correspondência.
6. Aprovação alterada, replay, falha parcial, retry idempotente.
7. Leitura Datadog real e limites/cotas; nenhuma criação durante descoberta.
8. Report Markdown registra regras, tags, equipe, destinos, janelas, gaps e execução; simulação jamais aparece como evidência real.

## Publicação

Este PR de front não faz deploy nem altera o motor. Não aplicar na Contabo antes de revisar o efeito do gate: novas avaliações simplificadas aguardam a extensão, enquanto cadastros, assistente e histórico funcionam. Integrar ambos os PRs após contrato e homologação alinhados.
