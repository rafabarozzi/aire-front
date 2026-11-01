# Próximas entregas de acesso e valor

Plano registrado em 2026-11-01. Este documento não habilita funcionalidades novas.

A especificação central está em [Evolução AIRE: descoberta ponta a ponta, acesso empresarial e valor](https://github.com/rafabarozzi/ai-reliability-platform/blob/main/docs/engineering/enterprise-and-discovery-roadmap.md).

Já disponível: cadastro assistido de clientes, SSO por workspace, papéis, vínculo de grupos Microsoft, consumo e conexão GitHub por token. Consulte [Onboarding empresarial](enterprise-onboarding.md) e [Conexões GitHub](github-connection.md).

Próximas entregas, com contratos compartilhados com o motor:

1. Escopos de equipe, repositório e jornada, aplicados no backend e nos artefatos derivados.
2. Histórico durável de baseline, propostas, aprovações, aplicações e resultados; não transformar falta de medição em zero.
3. GitHub App e token, ambos com instruções, teste e recuperação. Acesso da instalação não equivale ao acesso de cada usuário AIRE.
4. Subdomínio por cliente; piloto proposto northeialab.aire.northeia.com. Ainda não configurado em DNS, TLS ou SSO.
5. Painel inicial de entregas e resultados, distinguindo recomendação de alteração aplicada e custo de benefício.
6. Documentação de cliente gerada do Git; federação LDAP e SCIM como evolução futura.

O cadastro atual por /admin não provisiona sozinho a infraestrutura do cliente. Os subdomínios e a autorização por recurso exigem implementação e testes específicos. Não anunciar estas capacidades como já disponíveis.
