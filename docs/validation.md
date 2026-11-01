# Verificação da versão inicial

2026-10-31. Evidências obtidas no ambiente de desenvolvimento, antes da implantação na Contabo.

- 32 testes de contrato e segurança: isolamento de listagem/artefatos entre organizações, ausência de sessão, perfil insuficiente, expiração/adulteração, revogação de vínculo e permissão, CSRF, allowlist, limite de leitura e erros de upstream sem segredos.
- Criação de análise testada com GitHub e motor simulados, incluindo snapshot fixado por commit e isolamento do ID retornado. Não houve chamada a LLM.
- Projeção do manifesto testada para versão/analysis ID incorretos, referências ausentes e IDs duplicados. Preserva direção, condicionalidade e linha da evidência.
- TypeScript e build Next.js standalone validados localmente. O pipeline de prévia usa build Vinext separado.
- Interface verificada no navegador: temas claro e escuro, persistência do tema após recarga, criação simulada em três passos, pesquisa, erro de URL com instruções e bloqueio de avanço, seleção de serviço e painel de evidência.

Ainda exigem ambiente real: login Microsoft/Google, claims/grupos do diretório, token GitHub do tenant, ciclo completo do motor com narração/n8n, DNS/TLS, persistência Docker/k3s e teste de carga. A configuração de exemplo não contém segredos reais. Arquivos de implantação não equivalem a uma VM implantada.

## Administração de conexões

A suíte cobre cadastro/edição/exclusão de repositórios e credencial, criptografia em repouso, respostas sem segredo, isolamento entre tenants, bloqueio de fallback após exclusão, permissões, CSRF, conflitos de revisão e migração da política admin. Erros do GitHub são diferenciados sem refletir corpo ou URLs de autorização do provedor.

46 testes passaram após a alteração. A interface foi exercitada com dados sintéticos e respostas de API simuladas: cadastro com erro de credencial ausente, instruções de correção, cadastro/edição/exclusão da credencial, cadastro/edição/exclusão de repositório, validação, confirmação de exclusão e digitação sem perda de foco. O formulário de edição abre com o campo de token vazio. O fixture temporário foi removido antes do build de produção. Esses testes não equivalem a validar a credencial real do cliente ou a executar o motor.


## 2026-11-01 — mapa e relatório unificados

- 64 testes unitários passaram, incluindo extração integral de macrofluxos, preservação do restante do Markdown e recusa de conteúdo ativo em diagramas.
- TypeScript e build de produção Next passaram; os novos módulos passam no ESLint. O lint global mantém ocorrências preexistentes em outros componentes.
- Verificação em Chromium local, com respostas da API simuladas e relatório real de regressão: duas abas, 80 elementos gráficos (passos, decisões e legenda), rótulos presentes, zoom, tela cheia, artefatos e falha de carregamento com nova tentativa.
- Layout de 390 px sem transbordamento horizontal da página. O mapa e as tabelas extensas têm rolagem própria.
- Teste visual não autentica no SSO de produção nem substitui a nova análise na Contabo. Artefatos existentes permanecem imutáveis; Atualizar recarrega o estado e o relatório, não chama novamente o motor.
