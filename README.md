# AIRE Front

Console de confiabilidade da Northeia. A primeira versão cobre o mapeamento de jornadas e a revisão de evidências, com identidade AIRE, temas claro/escuro, login Google/Microsoft e autorização por organização no servidor.

## Executar a demonstração

Requer Node 22.13+ e pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
AIRE_MODE=demo pnpm run dev:node
```

Abra `http://localhost:3000`. O modo de demonstração é explícito, usa apenas fixtures sintéticas e não acessa GitHub, motor ou LLM. As jornadas simuladas duram apenas a sessão da página. A preferência de tema é salva no navegador. Sem `AIRE_MODE=demo`, a aplicação exige autenticação.

## O que está implementado

- Lista de jornadas, busca, filtros Gold/Silver/Bronze e ordenação.
- Assistente: validar repositório/revisão, definir jornada e revisar antes de enviar.
- Conexões: cadastrar, editar, excluir e validar repositórios; gerenciar uma credencial GitHub criptografada por workspace, com permissão específica e instruções de recuperação. Veja [o guia de conexões](docs/github-connection.md).
- BFF: valida a lista de repositórios da organização, fixa o SHA, baixa snapshot limitado a 50 MB, cria a análise e envia o ZIP à API v1 do motor.
- Consulta de estado, incluindo `AWAITING_NARRATION`. Esta versão não substitui o n8n nem executa a narração.
- Duas abas por jornada: Mapa da jornada (macrofluxo integral, com zoom/rolagem/tela cheia, seguido do relatório Markdown formatado) e Artefatos (downloads MD/JSON originais). Nenhum passo do diagrama é truncado por contagem.
- Download do Markdown e manifesto original. Na demo, o JSON é identificado como exemplo da interface e **não** se apresenta como manifesto canônico.
- Inventário Markdown das jornadas cadastradas. Ainda não é uma varredura automática de todos os endpoints de um repositório.
- OIDC Google e Microsoft Entra ID com Authorization Code, PKCE, state e nonce, usando `openid-client`.
- Sessão criptografada de 30 minutos em cookie `__Host-`, HttpOnly, Secure, SameSite=Lax. Credenciais permanecem no servidor.
- Vínculos por identificador imutável do usuário/provedor, RBAC aplicado em cada endpoint, política editável pelo administrador e grupos Entra configuráveis.
- Metadados, políticas e auditoria da edição de permissões separados por organização no volume persistente.

Os botões de observabilidade, SLOs e war rooms indicam módulos futuros. Mapeamento estrutural não equivale a prontidão operacional.

## Produção na Contabo

Veja [implantação no Ubuntu, Docker e k3s](docs/deployment.md), [SSO e organizações](docs/identity.md) e [contrato e limites](docs/architecture.md).

- Docker: Next.js standalone, usuário não root e volume `/data`.
- Docker Compose: Caddy com HTTPS, front sem porta exposta diretamente.
- k3s: Deployment com uma réplica, PVC, probes, Service e Ingress Traefik.
- Domínio sugerido, ainda não implantado: `aire.northeia.com`.

## Validação

```sh
pnpm run typecheck
pnpm test
pnpm run build:node
```

A CI repete esses comandos, constrói o Docker e verifica saúde e negação de acesso sem sessão. Testes de integração usam upstreams simulados; não equivalem a um login real nos provedores nem à execução do motor em produção.

Para a prévia privada no Sites, o projeto preserva o build Vinext e os helpers do starter. `pnpm build` é o build de prévia; `pnpm run build:node` é o build portátil usado no Docker. O runtime de produção na Contabo não depende de Sites. Não envie `.env.production`, arquivos de sessão ou volumes ao Git.


## Organizações, consumo e coletores privados

Veja [onboarding empresarial](docs/enterprise-onboarding.md) para habilitar o painel Northeia, cadastrar SSO por workspace, provisionar motores isolados no Atlas e vincular agentes de coleta. As áreas `/admin`, `/collectors` e `/usage` exigem autorização no backend. A operação do agente está no pacote `agents/collector` do repositório `ai-reliability-platform`.
