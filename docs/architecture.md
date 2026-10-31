# Arquitetura da primeira versão

Browser → BFF no mesmo domínio → GitHub / API v1 do motor. Credenciais do motor e dos provedores de IA ficam no servidor. Um responsável autorizado pode enviar um token GitHub pelo formulário de Conexões; o token salvo nunca é retornado ao navegador. O front não chama LLMs. No modo direto, o próprio motor chama o provedor de IA configurado, valida a narração e gera os artefatos. O modo externo permanece compatível com instalações anteriores.

## Fluxo real

1. OIDC resolve provedor e subject. O servidor deriva organização e perfil de sua configuração.
2. `POST /api/console/repositories/validate` valida a allowlist da organização, consulta repositório e resolve branch/commit para SHA de 40 caracteres.
3. `POST /api/console/journeys` revalida a autorização e a revisão. Faz download do snapshot pela API do GitHub, aceitando redirect apenas para HTTPS em `codeload.github.com`, sem encaminhar a credencial a esse host.
4. O ZIP é limitado a 50 MB. O motor recebe `POST /v1/analyses`, seguido por `PUT /v1/analyses/:id/source`. O diretório raiz produzido pelo zipball do GitHub atende o formato do snapshot do motor.
5. O ID é registrado no diretório da organização antes do upload. Falha de upload marca o registro local como falho; nova análise requer nova solicitação. A API não fornece idempotency key nesta versão.
6. A UI consulta estados e pausa entre consultas. `AWAITING_NARRATION` é mostrado explicitamente: esta versão não dispara nem assume que o n8n consumiu o novo ID. É necessário integrar o orquestrador à nova análise na implantação.
7. Artefatos são consultados no servidor após checagem de ownership. Apenas Markdown, técnico e manifesto são permitidos. HTML gerado não é servido na origem do console.

## API do console

| Método    | Caminho                                        | Permissão                    |
| --------- | ---------------------------------------------- | ---------------------------- |
| GET       | `/api/console/session`                         | Dados mínimos de sessão      |
| GET       | `/api/console/journeys`                        | `journeys:read`              |
| POST      | `/api/console/journeys`                        | `journeys:create`            |
| GET       | `/api/console/journeys/:id`                    | `journeys:read` + ownership  |
| GET       | `/api/console/journeys/:id/artifacts/manifest` | `artifacts:read` + ownership |
| GET       | `/api/console/journeys/:id/artifacts/markdown` | `artifacts:read` + ownership |
| POST      | `/api/console/repositories/validate`           | `journeys:create`            |
| GET       | `/api/console/connections`                     | `connections:read`           |
| GET / PUT | `/api/console/access`                          | `access:manage`              |
| POST      | `/api/console/logout`                          | Origin exato                 |

## Contratos e limites

O motor atual é o piloto com token estático e sem tenant nativo. O BFF separa credenciais e ownership, mas não transforma esse motor em um runtime multi-tenant de alta garantia. Para clientes distintos em produção, use instâncias/volumes/tokens de motor distintos, além de redes privadas. Nenhum recurso interno do motor deve ser acessível diretamente pelo navegador.

A projeção visual valida documentType, profile, versão, analysis ID, nós e referências de dependência/evidência. Não substitui a validação integral de schema e hashes realizada pelo motor. Os downloads preservam os bytes de origem. Não se deriva tecnologia ou disponibilidade de evidência insuficiente; campos desconhecidos ficam sem métrica.

O mapa real mostra até 24 elementos e até 12 relações/8 evidências no painel de seleção. Os totais e o arquivo exportado preservam o conjunto completo. A posição gráfica não é ordem de execução; linhas tracejadas representam condicionalidade, e relações assíncronas são identificadas na lista. As identidades são lógicas, sem assumir serviço/ambiente Datadog resolvido.

Persistência: um diretório por organização, arquivos JSON escritos com rename atômico e permissões restritas. Deploy de uma réplica; não usar armazenamento local como base para múltiplos pods concorrentes. Antes de escalar: banco transacional compartilhado, idempotência, fila persistente, limitação de taxa distribuída, auditoria completa e estratégia de retenção.

As fixtures são separadas e o modo demo exige configuração explícita. O modo live não faz fallback para dados falsos em caso de falha. O repositório público contém somente dados sintéticos, modelos de configuração vazios e o ativo de marca AIRE.

## Segurança e expansão

A primeira versão não inclui um teste de penetração ou homologação com clientes. A política CSP evita frames e origens externas, mas mantém inline scripts/styles exigidos pelo framework; nonce por resposta é uma melhoria planejada. Não há resolução Graph para excesso de grupos nem múltiplos issuers Microsoft na mesma implantação. TLS, backup, gestão/rotação de segredos, monitoramento do BFF e limite de requisições no proxy precisam fazer parte da implantação.

O inventário atual exporta jornadas cadastradas. A descoberta de outros endpoints e o inventário completo do repositório continuam sendo responsabilidade de uma futura extensão do motor.

## Administração de conexões

`GET /api/console/connections` retorna somente metadados e repositórios. `POST`, `PATCH` e `DELETE /api/console/connections/repositories` gerenciam a autorização de repositórios. `PUT` e `DELETE /api/console/connections/github` cadastram/substituem e removem a credencial. Mutações exigem `connections:manage`, Origin exato e revisão otimista; o tenant vem da sessão. A validação de repositórios aceita `journeys:create` ou `connections:manage`.

Tokens são gravados criptografados em `/data/<tenant>/connections.json`; veja `github-connection.md` para derivação da chave, compatibilidade com configuração por ambiente e limites da persistência. A política antiga de admin recebe a nova permissão obrigatória ao ser lida; nenhum outro perfil recebe permissões novas automaticamente.

