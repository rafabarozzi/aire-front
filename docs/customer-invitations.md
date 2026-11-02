# Onboarding de clientes por convite

O operador Northeia pode cadastrar uma organização em rascunho sem SSO e convidar o responsável por e-mail. O convidado cria uma senha local, configura e testa a identidade corporativa e confirma o primeiro administrador. Essa conta temporária permite somente configurar o SSO. Não autoriza jornadas, repositórios, integrações, billing ou administração da plataforma.

## Preparação do ambiente

1. Configure `AIRE_APP_ORIGIN` com a origem HTTPS pública do painel Northeia. O assistente usa essa origem central, mesmo quando o cliente ainda não tem DNS ou motor. Preserve `AIRE_SESSION_SECRET` e o volume `/data` entre atualizações.
2. Configure um remetente com domínio verificado no Resend e adicione no `.env.production` do front:

   ```dotenv
   AIRE_RESEND_API_KEY=re_SUBSTITUIR_NO_SERVIDOR
   AIRE_EMAIL_FROM="AIRE by Northeia <convites@northeia.com>"
   ```

   Use os registros DNS fornecidos pelo Resend para verificar o remetente; não substitua registros de e-mail existentes. A aplicação precisa de saída HTTPS para `api.resend.com`. Não coloque a chave no navegador, repositório ou chat. A chave é somente para envio; aceite pelo provedor não comprova entrega na caixa postal. Acompanhe rejeições e entrega no painel do provedor.
3. No aplicativo Microsoft usado pelo AIRE, registre como **Web**, além dos callbacks existentes:

   ```text
   https://aire.northeia.com/onboarding/auth/microsoft
   ```

   Para clientes em outro diretório, o aplicativo precisa aceitar contas de qualquer diretório organizacional e obter o consentimento exigido no diretório do cliente. O assistente usa o Tenant ID exato informado pelo cliente e valida o emissor e o `tid`. Mantenha o `AIRE_MICROSOFT_TENANT_ID` do operador; não transfira o domínio do cliente para esse diretório.
4. Para Google Workspace, registre `https://aire.northeia.com/onboarding/auth/google` no cliente OAuth Web. O assistente valida o domínio `hd` retornado pelo Google, não apenas o sufixo do e-mail.
5. Configure as credenciais globais `AIRE_MICROSOFT_CLIENT_ID/SECRET` e/ou `AIRE_GOOGLE_CLIENT_ID/SECRET`. Referências específicas a credenciais já existentes no cadastro são preservadas. O cliente não edita segredos nesse assistente. O login operacional futuro também exige o callback do portal do cliente, como `https://northeia-lab.northeia.com/auth/microsoft`.
6. Recrie o container do front após alterar as variáveis. Na instalação Contabo existente, use o procedimento `deploy/contabo/connect-front.sh` do motor, que preserva a composição de redes.

## Demonstração da POC

1. Entre no painel administrativo como operador Northeia.
2. Cadastre `northeia-lab`, nome `Northeia Lab`, domínio `https://northeia-lab.northeia.com`, plano `POC`, mensalidade `0` e o e-mail real do responsável pelo SSO. Escolha **Convidar o cliente para configurar SSO**; os dados SSO serão informados pelo próprio cliente. Com e-mail de convite, o cadastro sempre permanece em rascunho.
3. Salve. O resultado informa se o provedor aceitou o convite. Se falhar, o cadastro é preservado; edite a organização e use o painel **Convite de configuração** para reenviar. Cada novo convite invalida a senha e as sessões locais anteriores. O reenvio tem intervalo mínimo de um minuto.
4. O destinatário abre o link recebido, informa o mesmo e-mail e cria uma senha de 15 a 128 caracteres. O link é de uso único, com validade de 24 horas. O prazo total do acesso temporário é de 7 dias desde o convite.
5. No assistente, escolhe Microsoft ou Google. Para Northeia, informa o Tenant ID completo do diretório que já possui `northeia.com`. Opcionalmente informa os Object IDs dos grupos `admin`, `engineer` e `viewer`. Com grupos Microsoft, habilite as claims de grupos de segurança no ID token. Grupos ausentes/overage não concedem acesso implicitamente.
6. Salva e clica **Testar SSO**. Autentica com a identidade corporativa administradora. Se definiu grupo administrador, essa identidade precisa pertencer ao grupo retornado no token. Sem grupo administrador, a identidade testada será o primeiro administrador direto.
7. Confirma a administração e conclui. A senha e todas as sessões locais são revogadas. Alterar configuração exige novo teste; o teste vale dez minutos. O teste SSO não cria sessão de uso normal da plataforma.
8. O operador atualiza o cadastro para ver a configuração salva. A organização continua em rascunho até DNS, callback do portal e motor estarem prontos e a verificação de ativação passar. O convite não provisiona infraestrutura nem contorna essa validação.

## Operação e limites desta versão

- O painel de convite mostra estado, aceite/falha do envio e validade. Reenvio e revogação estão disponíveis apenas ao operador. Não retorna links secretos ou hashes de senha.
- A recuperação da senha temporária ocorre por novo convite emitido pelo operador. O cliente não recebe uma conta local permanente ou um caminho alternativo ao SSO.
- Alterações de diretório/grupos após a conclusão permanecem no cadastro administrativo atual. Este assistente é destinado ao onboarding de organizações em rascunho.
- Eventos de configuração ficam em `/data/onboarding/audit.jsonl`; dados de configuração ficam por organização, com permissões restritas. Convites e sessões são armazenados como hashes; senhas usam scrypt com salt. Sessões verificam revogação no servidor, além da expiração do cookie.
- O armazenamento de arquivo requer um único escritor compartilhando o mesmo volume, como o front atual. Escala com múltiplas réplicas exige migrar estado, locks e auditoria para banco transacional. Não reutilize a implementação de arquivo em volumes independentes.
- Provisionamento automático de motor, DNS, namespace e ingress fica para a evolução de infraestrutura. DNS também pode ser automatizado por API do provedor ou estratégia wildcard; não é configurado neste fluxo.
- GitHub App, GitLab e integrações operacionais fazem parte do fluxo posterior ao SSO e à ativação; o convite não altera essas capacidades.

## Validação

Testes automatizados usam e-mail sintético e provedor simulado, sem envio real. Cobrem restrições de acesso, CSRF, uso único, expiração, reenvio, revogação, grupos e conclusão. A entrega real e o login real no Entra/Google precisam ser validados com o remetente e o aplicativo configurados no ambiente publicado.

## Identidade do remetente e convite visual

Os convites são enviados com versão HTML e texto simples: identidade AIRE, nome da organização, três etapas e botão **Configurar meu acesso**, além de um link alternativo. A versão HTML usa tabelas e estilos inline, sem imagens remotas, fontes externas ou pixels de rastreamento. O botão mantém o token no fragmento do endereço. Mantenha o rastreamento de cliques e aberturas desativado no domínio Resend usado para convites. O renderizador do cliente de e-mail pode modificar cores, espaçamentos ou cantos.

O avatar ao lado do remetente é decidido pelo Outlook/Gmail/contatos do destinatário, independentemente do HTML. Um alias da caixa pessoal pode ser resolvido pelo Outlook como a mesma pessoa. Para separar a identidade, use uma caixa compartilhada Microsoft 365 com endereço próprio:

1. Remova somente o alias `onboarding@northeia.com` da conta Rafael, preservando a conta, o endereço principal e as mensagens.
2. Em **Microsoft 365 Admin → Equipes e grupos → Caixas de correio compartilhadas**, crie uma caixa chamada **AIRE by Northeia**, endereço `onboarding@northeia.com`. Aguarde a liberação do endereço se ele ainda constar em uso.
3. Adicione Rafael como membro. Para responder pelo Outlook com a marca, conceda **Acesso total** e **Enviar como**. Mantenha o login direto da caixa compartilhada bloqueado.
4. Mantenha o envio automatizado pelo Resend e `AIRE_EMAIL_FROM="AIRE by Northeia <onboarding@northeia.com>"`. Não precisa alterar a chave do Resend nem os MX Microsoft por causa dessa mudança.
5. Envie um novo convite após a atualização. Mensagens antigas e contatos em cache podem continuar exibindo a foto anterior. O HTML não garante o avatar em todos os clientes.

Uma caixa compartilhada de até 50 GB, no uso básico, não requer licença própria; o usuário que a acessa precisa de uma caixa licenciada Exchange Online. Recursos avançados podem ter requisitos adicionais.

Referências oficiais: [Criar caixa compartilhada](https://learn.microsoft.com/en-us/microsoft-365/admin/email/create-a-shared-mailbox) e [Licenciamento e uso](https://learn.microsoft.com/en-us/microsoft-365/admin/email/about-shared-mailboxes).

### Retomar a configuração

Na tela de login, use **Primeiro acesso ou configurar SSO**. O link leva ao portal central de onboarding; quando aberto pelo portal de um cliente, preenche a organização correspondente. Uma sessão temporária válida retoma a configuração. Sem sessão, informe organização, e-mail convidado e senha já criada. Para criar a senha pela primeira vez, use o convite recebido por e-mail. O formulário de convite também oferece **Já criei meu acesso — retomar configuração**.

Os campos de senha e confirmação possuem controles independentes **Exibir/Ocultar**. As senhas começam ocultas. Os prazos e as permissões restritas do acesso temporário permanecem os mesmos.
