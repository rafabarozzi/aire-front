# Sessões persistentes do console

O callback OIDC antes criava um cookie/JWE com prazo fixo de 1800 segundos, sem renovação. Agora ambos usam sete dias, com renovação em respostas autenticadas da API e da consulta de sessão. A renovação ocorre no máximo uma vez por hora e nunca ultrapassa 30 dias desde o login original. Depois desse limite ou da expiração por inatividade, exige novo SSO.

O cookie continua `__Host-aire-session`, Secure, HttpOnly, SameSite=Lax, Path=/, sem Domain. Não são gravados tokens em localStorage. Cookies do fluxo OIDC e da identidade temporária de onboarding mantêm seus prazos curtos. A persistência não altera o vínculo por origem/workspace nem a consulta das permissões e associação local em cada requisição.

Sessões de 30 minutos ainda válidas migram no próximo uso autenticado. Uma sessão já expirada precisa de novo login; não é recuperada sem autenticação.

Logout grava revogação durável pelo identificador da sessão em `AIRE_DATA_DIR/session-revocations` antes de limpar os cookies. Tokens renovados mantêm esse identificador; replay após logout é rejeitado. Os arquivos têm modo 0600, diretório 0700 e não contêm identidade nem credenciais. Uma renovação concorrente não torna um token revogado válido novamente. Falha de gravação impede a confirmação de logout; o usuário pode repetir.

Na Contabo, preservar `/data` e o mesmo `AIRE_SESSION_SECRET` entre reinícios/recriações. Trocar a chave invalida todas as sessões. Não gerar uma chave nova em cada deploy. Múltiplas réplicas devem compartilhar a chave e o armazenamento de revogações. Um reinício de browser normal preserva o cookie; navegação anônima ou limpeza de cookies não.

A expiração é renovada por requisições, incluindo consultas automáticas de uma página aberta. Não representa detecção de interação humana. Mudanças de grupos feitas exclusivamente no provedor de identidade são percebidas no próximo SSO; remoção de associação ou mudança de política no AIRE continua sendo verificada a cada requisição. Reautenticação periódica continua necessária.

Testes cobrem flags/prazo, migração, teto absoluto, tokens expirados, ausência de renovação em falhas e replay após logout. Nenhuma alteração na configuração da VM é necessária se o volume e a chave atuais já forem persistentes.
