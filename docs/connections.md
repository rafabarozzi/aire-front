# Conexões da organização

O administrador configura **Código-fonte**, **Observabilidade** e consulta **Identidade e ambiente**. GitHub e GitLab podem coexistir. ServiceNow/Jira e Teams/Slack aparecem como próximos conectores, sem ações habilitadas.

## GitHub

O token existente continua funcionando sem migração. Para uma nova conexão, escolha:

- **Token**: fine-grained PAT, com os repositórios selecionados e Contents/Metadata em Read. Tokens clássicos já cadastrados continuam aceitos; prefira o escopo mínimo. Autorize SSO quando exigido pela organização.
- **GitHub App**: crie o App nas configurações da organização GitHub, conceda Contents: Read e Metadata: Read, desative webhooks se não forem necessários e instale-o apenas nos repositórios escolhidos. Informe o App ID (ou Client ID), o Installation ID e a chave privada RSA PEM. O Installation ID aparece no endereço da instalação em Settings → GitHub Apps → Configure. Este fluxo usa um App do cliente; não é uma instalação OAuth de um App compartilhado da Northeia.

A chave PEM é cifrada. O servidor assina JWTs de curta duração e solicita tokens de instalação limitados à leitura. Esses tokens ficam somente em memória, por organização, e são renovados antes da expiração. Substituir a chave muda a identidade do cache; remover a conexão bloqueia novas operações e não reativa tokens legados. A remoção no AIRE não revoga o token no GitHub: para revogação global, remova a instalação/chave ou revogue o PAT no provedor.

Após salvar, use **Testar conexão**, **Buscar repositórios** e **Adicionar** nos itens desejados. A busca filtra os resultados carregados; **Carregar mais** consulta a próxima página (100 itens). Também é possível informar uma URL diretamente.

## GitLab

Nesta versão, use **GitLab.com** com token pessoal, de grupo ou de projeto, escopo `read_api` e papel que permita ler o código (Reporter ou superior). A disponibilidade de tokens de grupo/projeto depende do plano e das permissões no GitLab. Deploy tokens não servem para a API de catálogo.

O catálogo consulta projetos dos quais a identidade do token é membro. Projetos públicos acessíveis que não apareçam podem ser cadastrados pela URL. Subgrupos são suportados: `https://gitlab.com/empresa/squad/repositorio`. URLs de instâncias Self-Managed não são aceitas neste conector.

O AIRE resolve a branch para um SHA e baixa o ZIP desse commit. O limite de snapshot continua em 50 MB. GitHub preserva sua identidade `owner/repo`; GitLab usa a URL completa, evitando misturar jornadas de provedores diferentes. O coletor privado existente continua com o contrato GitHub; GitLab usa coleta direta pelo servidor nesta versão.

## Repositórios autorizados

A credencial define o acesso no provedor; o cadastro de repositórios define a autorização dentro do tenant AIRE. Ter acesso pelo token/App não autoriza automaticamente todos os repositórios no AIRE. Administradores podem listar, adicionar, editar e remover. Usuários com permissão de mapear selecionam e buscam na lista já autorizada.

Editar/remover afeta novos mapeamentos e preserva o histórico. Antes de cada análise, o servidor verifica novamente autorização e commit. Os testes de conexão não garantem acesso a todos os repositórios: use **Validar** no repositório escolhido.

## Datadog e Dynatrace

| Conector | Cadastro | O que o teste verifica |
| --- | --- | --- |
| Datadog | Site, API Key e Application Key | `/api/v2/validate_keys`, validação do par de chaves |
| Dynatrace | URL SaaS `https://<ambiente>.live.dynatrace.com` e Environment API Token | GET `/api/v2/entities?pageSize=1`, requer `entities.read` |

Prefira credenciais de serviço com leitura mínima. Salvar/testar não inicia coleta, não altera monitores e não atesta prontidão operacional. A Etapa 2 verificará os escopos adicionais e executará somente recomendações aprovadas. Dynatrace Managed, URLs Platform e OAuth não estão habilitados neste formulário.

## Contrato para a Etapa 2

As credenciais pertencem ao front servidor, em `integration-{provider}.json` dentro do diretório do tenant (`AIRE_DATA_DIR`). O módulo `lib/server/integrations.ts` expõe `integration(tenant, provider)` somente para uso no servidor; nunca importe-o em componentes client. O valor é `undefined` quando nunca configurado, `null` após remoção, ou uma união tipada de credenciais. O endpoint do navegador retorna apenas metadados.

A frente da Etapa 2 deve integrar esse módulo a um adaptador servidor-servidor autenticado e vinculado ao tenant. Não há endpoint que exporte chaves para o navegador, nem envio automático destas chaves ao motor nesta entrega. Não presuma que ter credenciais salvas equivale a coleta ativa. Antes de habilitar descoberta, confira escopos, orçamento/rate limits, estado de remoção e aprovação para operações de escrita.

## Operação e atualização

- Aplique o ajuste `AnalysisInput.repository` do motor antes do front para habilitar snapshots GitLab. GitHub permanece compatível.
- Mantenha o volume persistente do front e `AIRE_CREDENTIAL_SECRET` (ou o `AIRE_SESSION_SECRET` existente) estável, com pelo menos 32 caracteres. Não inclua segredos no Git ou nos logs.
- Cada credencial usa AES-256-GCM e chave derivada por tenant/provedor. Arquivos são escritos com modo `0600`, troca atômica e revisão otimista. Mantenha uma instância gravadora por volume, conforme o armazenamento atual da plataforma.
- Depois de perda/troca da chave de proteção, a tela sinaliza a necessidade de substituir credenciais. O histórico e a lista de repositórios permanecem disponíveis.
- A API legada `/connections/github` retorna conflito após migração para a nova conexão, evitando salvar/excluir uma credencial que não seria a usada.
- Testes automatizados usam respostas simuladas. Valide uma conexão real de cada provedor em homologação antes do rollout.

## Referências

- [GitHub App installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/)
- [GitLab repository archives](https://docs.gitlab.com/api/repositories/)
- [Datadog API e Application Keys](https://docs.datadoghq.com/account_management/api-app-keys/)
- [Dynatrace API authentication](https://docs.dynatrace.com/docs/dynatrace-api/basics/dynatrace-api-authentication)

### Referências na instância de revisão

Quando uma revisão isolada usa a mesma organização e outra chave de proteção, o provisionador pode gravar `connection-references.json` no diretório do tenant. O registro contém apenas o ID do tenant, `observedAt` (UTC), o indicador opcional `github: true` e, para Datadog, o objeto opcional `datadog: { "engineReadBridge": true }`. Antes de declarar um vínculo, o provisionador verifica a identidade do tenant e a origem do bridge no motor. As referências exibem quando o cadastro foi conferido no portal principal. O status de leitura de Datadog vem das capacidades atuais do motor da própria organização. Cadastro, substituição ou remoção local têm precedência. A autenticação com provedores continua usando exclusivamente as fontes de credenciais configuradas para aquela instância.
