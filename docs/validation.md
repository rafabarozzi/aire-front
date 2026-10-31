# Verificação da versão inicial

2026-10-31. Evidências obtidas no ambiente de desenvolvimento, antes da implantação na Contabo.

- 32 testes de contrato e segurança: isolamento de listagem/artefatos entre organizações, ausência de sessão, perfil insuficiente, expiração/adulteração, revogação de vínculo e permissão, CSRF, allowlist, limite de leitura e erros de upstream sem segredos.
- Criação de análise testada com GitHub e motor simulados, incluindo snapshot fixado por commit e isolamento do ID retornado. Não houve chamada a LLM.
- Projeção do manifesto testada para versão/analysis ID incorretos, referências ausentes e IDs duplicados. Preserva direção, condicionalidade e linha da evidência.
- TypeScript e build Next.js standalone validados localmente. O pipeline de prévia usa build Vinext separado.
- Interface verificada no navegador: temas claro e escuro, persistência do tema após recarga, criação simulada em três passos, pesquisa, erro de URL com instruções e bloqueio de avanço, seleção de serviço e painel de evidência.

Ainda exigem ambiente real: login Microsoft/Google, claims/grupos do diretório, token GitHub do tenant, ciclo completo do motor com narração/n8n, DNS/TLS, persistência Docker/k3s e teste de carga. A configuração de exemplo não contém segredos reais. Arquivos de implantação não equivalem a uma VM implantada.
