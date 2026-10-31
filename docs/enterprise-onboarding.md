# Clientes, identidade e coletores

Esta versão adiciona `/admin` (operação Northeia), `/collectors` e `/usage` (workspace). As telas usam os mesmos temas claro/escuro. O gateway de máquinas é `/api/agents/{tenant}`; o motor fica privado no Atlas.

## Habilitar operação Northeia

O acesso global depende de `AIRE_PLATFORM_ADMINS_JSON`, além do vínculo normal com o workspace operador. Exemplo com identificadores sintéticos:

```dotenv
AIRE_PLATFORM_ADMINS_JSON='[{"provider":"microsoft","issuer":"https://login.microsoftonline.com/SEU-TENANT-ID/v2.0","subject":"SEU-SUBJECT-IMUTAVEL"}]'
```

Após atualizar, encerre e reabra a sessão para incluir o issuer. Consulte a resposta autenticada de `/api/console/session` no navegador: `identity.issuer` e `identity.subject` pertencem somente ao usuário atual. Copie esses valores para o arquivo de ambiente da VM. Não use e-mail nem o papel admin como critério global. Recrie o front com `connect-front.sh`; o link **Clientes e consumo** aparece somente para as identidades autorizadas.

## Primeiro cliente

1. Provisione o motor isolado no Atlas com `deploy/contabo/configure-tenant.sh` do repositório `ai-reliability-platform`, configure sua IA e inicie-o. O script adiciona URL/token exclusivos ao ambiente do front. Atualize primeiro o motor Northeia para ganhar seu alias de rede estável.
2. Em `/admin`, cadastre ID, nome, plano e provedor. Microsoft: Tenant ID. Google: domínios Workspace aprovados. A Northeia valida esses dados com o administrador contratante no onboarding assistido; não há prova DNS automática nesta versão.
3. O administrador inicial pode ser vinculado pelo Object ID Microsoft ou subject Google. Também é possível deixar o campo vazio até testar SSO: nenhum usuário ganha acesso apenas pelo domínio. Grupos Microsoft usam Object IDs e papéis explícitos.
4. Ative a organização. O backend verifica se o motor declara o mesmo cliente e aceita a credencial configurada. Distribua `https://aire.northeia.com/?workspace=ID_DO_CLIENTE`.
5. Se a identidade autenticar mas não tiver vínculo, a tela mostra somente os identificadores da própria identidade, por cinco minutos. O administrador contratante confirma o usuário e a Northeia registra o vínculo/grupo no painel. Esse teste não cria sessão autorizada nem concede papéis.
6. Cadastre os repositórios em Conexões. Para ambiente privado, não envie a credencial GitHub ao AIRE: instale-a no agente e use Coletores privados para a vinculação.

## Microsoft e Google

O app Microsoft usado pelo AIRE deve ser registrado para contas organizacionais de vários tenants. O administrador do cliente consente a aplicação e configura a atribuição de usuários/grupos. O código usa descoberta OIDC no tenant específico do workspace, com validação de issuer, tenant, state, nonce e PKCE. O callback permanece `/auth/microsoft`; o workspace vem do cookie criptografado do fluxo, não de um parâmetro não confiável no retorno.

No Google, o projeto OAuth do AIRE deve admitir usuários externos autorizados. Cada workspace configura domínios aceitos; o código confere `hd` do token e a associação explícita de usuário. Compartilhar domínio de e-mail não cria associação. O callback permanece `/auth/google`.

Esta entrega usa os Client IDs/secrets globais dos aplicativos Northeia para Microsoft e Google. Não permite cadastrar secrets por cliente na interface. SAML, SCIM, convites automatizados, prova de domínio DNS e sincronização Graph para group overage permanecem fora desta versão. Tokens com excesso de grupos não ganham autorização por grupos ausentes; usuários com vínculo direto ainda podem entrar. Revogar acesso no IdP pode demorar até a sessão AIRE expirar (30 minutos); remover o vínculo ou suspender o cliente no AIRE bloqueia as próximas requisições imediatamente.

## Consumo e operação

A visão do workspace mostra plano e tokens, sem custos internos. A visão Northeia consulta somente o motor do cliente selecionado, com competência UTC, custos estimados e medições desconhecidas sinalizadas. O rateio de infraestrutura é manual; mensalidades/infra são expressas em USD nesta versão. O painel não emite fatura, calcula impostos ou aplica automaticamente limites monetários.

Configurações gerenciadas ficam em `/data/managed-tenants.json`, com revisão e gravação atômica. Configuração de ambiente legada continua válida; um cadastro gerenciado com o mesmo ID tem precedência. O operador não pode editar sua própria organização pelo painel para evitar bloqueio acidental. Há log de mudanças em `/data/platform-audit.jsonl`. Use uma instância escritora do front; se houver interrupção durante uma alteração, verifique e remova o lock obsoleto `managed-tenants.lock` somente após garantir que nenhum escritor está ativo.

Não há remoção destrutiva de organizações pela interface: suspenda para interromper novos acessos e preserve os dados até executar o procedimento de retenção contratado. Instâncias de clientes no Atlas compartilham o host; são separados seus tokens, volumes e processos, não o hypervisor.
