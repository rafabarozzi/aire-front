# Portais, histórico e medição — versão 0.2.0

## Dois públicos

`https://aire.northeia.com` é o painel operador quando `AIRE_PORTAL_MODE=multi`. Somente identidades declaradas em `AIRE_PLATFORM_ADMINS_JSON` (provider, issuer e subject exatos) entram. O administrador da plataforma não precisa ser membro de uma organização cliente. O painel não oferece APIs de jornadas no domínio operador.

Cada organização tem `publicOrigin`, por exemplo `https://northeia-lab.northeia.com`. As sessões são criptografadas, vinculadas à origem e usam cookies `__Host-` sem Domain. O servidor resolve o tenant pelo Host cadastrado e confere a identidade do workspace; `X-Forwarded-Host` não autoriza acesso. Caddy deve preservar Host. Domínios desconhecidos, tenants suspensos, sessão de outro domínio e administração de plataforma no domínio cliente são recusados.

O modo legado continua disponível durante a migração. Não ative o modo multi antes de registrar o operador e preparar o portal dos clientes.

## Cadastro e SSO

1. Em Clientes e consumo, cadastre identificador, nome, origem HTTPS, plano e tenant Microsoft ou domínio Google Workspace. Salve em rascunho.
2. Provisione o motor isolado com o mesmo `AIRE_TENANT_ID`, credencial, diretório e porta próprios. O painel testa `/healthz` e autenticação antes de ativar. Reutilizar referências de URL/token de outro cliente é recusado.
3. Crie o registro DNS A/AAAA do subdomínio para o servidor e adicione o host ao Caddy, usando `reverse_proxy 127.0.0.1:3001`.
4. No aplicativo Entra, plataforma **Web**, registre `https://northeia-lab.northeia.com/auth/microsoft`. Para outro diretório, o aplicativo deve aceitar aquele tenant e receber o consentimento necessário. Alternativamente configure `sso.microsoftClientIdEnv` e `sso.microsoftClientSecretEnv` com referências de variáveis exclusivas do cliente. Google tem os campos equivalentes e callback `/auth/google`.
5. Cadastre Object ID Microsoft ou subject Google do administrador do cliente, ou Object IDs dos grupos Microsoft com seus papéis. Domínio de e-mail sozinho nunca concede acesso. O diagnóstico exibido após um teste SSO sem vínculo traz a identidade verificada para esse cadastro.
6. Ative a organização e entre pelo seu subdomínio. O portal mostra seu nome e seleciona o workspace automaticamente. Cadastre credencial GitHub e repositórios em Conexões.

Para criar o laboratório sem copiar o JSON de cadastro, execute **no container front**, como seu usuário de execução:

```sh
node scripts/seed-northeia-lab.mjs OBJECT_ID_DO_USUARIO_CORPORATIVO
```

O argumento é opcional; sem ele, a organização nasce sem membros e sem conceder acesso. A ferramenta usa o Tenant ID Microsoft já configurado, salva em rascunho e preserva um cadastro existente. Ela não cria DNS, usuário ou aplicativo no Entra. Configure/ative o cadastro pela interface após provisionar o motor.

## Jornada e versões

Uma jornada é identificada por organização, repositório (sem diferença entre maiúsculas/minúsculas), método e caminho HTTP e subdiretório normalizado. Nome, criticidade e commit não criam outra identidade. Subdiretórios e métodos distintos permanecem separados.

A lista reúne análises antigas da mesma identidade sem excluir seus arquivos. Uma revisão nova cria outra versão. A mesma revisão concluída e criticidade retorna a análise existente, sem chamada à IA; a opção de reanalisar permite uma nova versão explícita. Enquanto uma análise estiver em andamento, a solicitação abre essa análise. Um bloqueio em disco serializa a preparação da mesma jornada entre processos. Depois de uma interrupção abrupta, verifique que não há preparação ativa antes de remover um arquivo residual de `/data/<tenant>/locks`.

O seletor de histórico abre MD/JSON da análise escolhida. Relatórios antigos são preservados: reanalise para receber o novo formato. Análises de versões anteriores que não registravam subdiretório são agrupadas como raiz; não é possível inventar o subdiretório original.

## Billing e evolução

Billing consulta o ledger de cada motor, por mês UTC. Exibe tentativas, tokens, custo conhecido de IA, tentativas sem preço/medição, infraestrutura mensal estimada e mensalidade contratada separadamente. O preço é versionado pelo catálogo `AIRE_PRICE_CATALOG_JSON` do motor. Indisponibilidade de motor não vira custo zero. A tela não emite fatura nem confunde custo operacional com preço ao cliente. Infraestrutura é rateio informado, não medição de nuvem. Planos e rateios exibidos são os vigentes no cadastro, sem prorrateio retroativo.

O painel cliente registra análises e mudanças de estado de forma idempotente em armazenamento persistente. Mostra jornadas únicas, versões, repositórios e análises por mês de criação com o estado atualmente conhecido. Histórico anterior vem dos registros já existentes; não representa uma observação antiga inventada. Alertas criados/ajustados, horas poupadas e retorno financeiro continuam **não medidos** até integração e aplicação comprovada de ações na Etapa 2. Sugestão não é resultado executado.

## Atualização e validação

Atualize os dois repositórios, execute o build Node/Contabo e mantenha os dois arquivos Compose (`compose.contabo.yaml` e `compose.engine.yaml`). `/healthz` deve informar `version: 0.2.0` e `journeyTabs: 2`; o rodapé também mostra a versão. Se a tela ainda tem quatro abas, o container front não está executando este build.

Validações: testes de replay de cookies entre hosts, CSRF, operador sem membership, recusa de administrador cliente no painel operador, preservação de histórico, deduplicação e isolamento de billing. Confirme o login real de cada provedor após cadastrar DNS e redirect; credenciais e o Entra não são simulados por esses testes.
