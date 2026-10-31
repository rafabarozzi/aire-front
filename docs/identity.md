# SSO, organizações e RBAC

O login autentica a identidade. O vínculo cadastrado no servidor autoriza o acesso à organização. Não existe cadastro automático por domínio de e-mail nem seleção de tenant controlada pelo navegador.

## Google

Cadastre um cliente OAuth do tipo aplicação web, defina a audiência e configure o consentimento apropriado à organização. Use:

- Redirect URI: `https://aire.northeia.com/auth/google`
- `AIRE_GOOGLE_CLIENT_ID`
- `AIRE_GOOGLE_CLIENT_SECRET`

O cliente usa descoberta em `https://accounts.google.com` e escopos `openid profile email`. Registre em `members` o `sub` imutável e verificado do usuário para esse provedor. Um e-mail não substitui o `sub`. Obtenha o identificador por um fluxo OIDC confiável da organização; nunca cole um ID token ou client secret no chat/repositório.

## Microsoft Entra ID

Registre uma aplicação web em um tenant específico e configure:

- Redirect URI: `https://aire.northeia.com/auth/microsoft`
- `AIRE_MICROSOFT_TENANT_ID` (GUID; `common`/`organizations` não são aceitos)
- `AIRE_MICROSOFT_CLIENT_ID`
- `AIRE_MICROSOFT_CLIENT_SECRET`

Esta versão suporta um issuer Microsoft por implantação. Clientes de diretórios distintos exigem federação B2B para esse issuer ou uma expansão posterior da configuração OIDC por organização. Não habilite emissores arbitrários no formulário de login.

Para grupos, configure claims de grupos relevantes no ID token e associe o Object ID de cada grupo a um perfil em `groups`. Só grupos verificados do Microsoft podem conceder acesso. Claims de overage não são resolvidas via Graph nesta versão; sem grupo explícito o acesso por grupo não é concedido. Prefira os grupos atribuídos à aplicação para limitar o tamanho do token. Quando houver muitos grupos mapeados, use um vínculo direto até estender a resolução por Graph.

## Vínculos e perfis

Use `docs/tenants.example.json` como estrutura, substituindo placeholders. Cada tenant tem sua própria lista de repositórios, referências a variáveis de credenciais e diretório de dados. Credenciais nunca são serializadas na sessão, resposta de configuração ou HTML.

- `members`: provedor + `subject` (`sub` do ID token) + perfil.
- `groups`: IDs de grupos do issuer Microsoft configurado + perfil.
- Um vínculo direto prevalece sobre os grupos; entre grupos, prevalece o perfil mais permissivo.
- Identidade com associação a mais de uma organização é negada nesta versão. Não há troca de organização nem seleção arbitrária de tenant.
- `admin`: todas as permissões, inclusive administrar acessos.
- `engineer`/`viewer`: permissões editáveis pelo administrador na tela Equipe e acessos. O administrador pode conceder administração a outro perfil deliberadamente.

Vínculos de usuário e grupo são geridos na configuração do servidor. A UI gerencia a política dos perfis, não provisiona usuários no provedor. Mudanças de permissões geram registro em `<tenant>/audit.jsonl`. Não é um log de auditoria completo de todas as ações.

## Segurança da sessão

Authorization Code + PKCE S256 + state + nonce, processados por `openid-client`. O callback usa o endereço HTTPS fixo de `AIRE_APP_ORIGIN`, não o header Host recebido. Tokens dos provedores não ficam no navegador nem são persistidos; a sessão AIRE criptografada contém apenas os identificadores e grupos mapeados. Ela expira após 30 minutos, sem renovação automática.

Remover um vínculo ou revogar uma permissão bloqueia a próxima requisição, mesmo com uma sessão existente. Alterações de grupos no diretório refletem no próximo login (até 30 minutos para uma sessão já emitida). Sair apaga a sessão local; não encerra a sessão global do Microsoft/Google. Rotacionar `AIRE_SESSION_SECRET` invalida todas as sessões AIRE. O cookie da transação de login dura 10 minutos.

As mutações exigem Origin exato. Todos os endpoints de dados verificam sessão e autorização. Antes de qualquer chamada ao motor por ID, o BFF procura o ID no diretório do tenant. Não confie apenas em esconder botões no frontend.

## Homologação ainda necessária

Os testes automatizados cobrem autorização, isolamento, cookies, adulteração e expiração de sessão, CSRF e contratos de integração simulados. O fluxo real Google/Entra precisa ser homologado com seus client IDs, callbacks, usuários e grupos antes de liberar clientes externos.

Fontes primárias:

- https://github.com/panva/openid-client/blob/main/examples/oidc.ts
- https://developers.google.com/identity/openid-connect/openid-connect
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc
