# Gerenciar conexões pelo painel

Em **Conexões**, quem tem a permissão **Gerenciar repositórios e credenciais** pode cadastrar, editar e excluir repositórios e a credencial GitHub da própria organização. Administradores possuem essa permissão por padrão. Os demais perfis precisam recebê-la em **Equipe e acessos**.

## Cadastrar e validar um repositório

1. Clique em **Novo repositório** e informe `https://github.com/organizacao/repositorio` ou `organizacao/repositorio`.
2. Clique em **Salvar e validar**. O cadastro autoriza o repositório no workspace e o AIRE tenta consultar sua branch padrão.
3. Se faltar uma credencial ou houver outra falha, a própria tela mostra a causa, quem pode resolver e o procedimento correspondente. O cadastro permanece disponível para corrigir a conexão sem repetir o preenchimento.
4. Após a correção, clique em **Tentar novamente** ou **Validar conexão** na linha do repositório.
5. **Conexão validada** mostra a branch e o commit consultados. **Mapear jornada** abre o formulário com o repositório preenchido; o mapeamento revalida a revisão antes de enviar código ao motor.

A validação não chama o motor nem uma IA. Uma credencial cadastrada ainda precisa ter suas permissões confirmadas em um repositório.

## Cadastrar, editar e excluir a credencial

Esta versão gerencia **uma credencial GitHub ativa por workspace**, usada nos seus repositórios. Ela pode ser substituída pelo painel.

1. No GitHub, abra https://github.com/settings/personal-access-tokens/new . Dê um nome e validade ao token e selecione o proprietário correto em **Resource owner**.
2. Em **Repository access → Only select repositories**, selecione os repositórios necessários.
3. Conceda **Contents: Read-only**. **Metadata: Read-only** é incluída automaticamente. Se a organização exigir aprovação, aguarde a aprovação para acessar repositórios privados.
4. No AIRE, clique em **Cadastrar credencial**, informe um nome e cole o token. Clique em **Salvar credencial**.
5. Valide um repositório para confirmar o acesso.

Em **Editar credencial**, altere o nome e, opcionalmente, informe um novo token. Deixar o campo vazio mantém o token atual. O valor salvo nunca é retornado ao navegador; o campo começa vazio em toda edição.

**Excluir credencial** exige confirmação e bloqueia futuras consultas ao GitHub até um novo cadastro. A exclusão não revoga o token no GitHub; essa revogação é feita nas configurações da conta GitHub. A exclusão pelo painel também impede o uso de uma credencial antiga que ainda exista nas variáveis do servidor.

As mudanças valem nas próximas requisições, sem reiniciar o front. Requisições ao GitHub já em andamento podem concluir com a credencial que receberam antes da alteração.

## Editar e excluir repositórios

Use os botões de edição e exclusão na linha de cada repositório. Não é possível cadastrar o mesmo repositório duas vezes, inclusive com diferenças de maiúsculas/minúsculas. Excluir remove a autorização para novos mapeamentos e preserva análises já cadastradas.

Se outra pessoa salvar uma alteração enquanto você edita, o AIRE bloqueia a gravação com uma mensagem de conflito e atualiza a lista. Revise e salve novamente.

## Erros apresentados

- **Credencial ausente:** mostra o procedimento de criação do token e cadastro no AIRE.
- **Credencial recusada pelo GitHub:** orienta conferir expiração/revogação e substituir o token.
- **Repositório não autorizado no AIRE:** orienta cadastrá-lo em Conexões.
- **403 com SSO explícito:** orienta autorizar a credencial na organização GitHub. Um 403 genérico também pode indicar permissões, aprovação pendente ou restrições de rede.
- **404 do repositório:** pode indicar nome incorreto ou falta de acesso a um repositório privado; a tela não presume que ele não existe.
- **404 da revisão:** orienta conferir branch/commit e Contents: Read-only.
- **Limite de consultas:** orienta aguardar, sem pedir a criação de outra credencial.
- **Falha temporária:** orienta verificar disponibilidade e tentar novamente.

## Persistência e proteção

Os dados ficam em `<AIRE_DATA_DIR>/<tenant>/connections.json`, com escrita atômica e modo 0600. O token usa AES-256-GCM com uma chave derivada por HKDF, separada para cada tenant. O segredo base é `AIRE_CREDENTIAL_SECRET`, quando configurado; caso contrário, é usado `AIRE_SESSION_SECRET`. A chave derivada não é persistida com o arquivo. O volume e o segredo base devem fazer parte de backups protegidos.

Defina `AIRE_CREDENTIAL_SECRET` antes de cadastrar tokens se quiser uma chave independente da sessão. Alterar o segredo usado para derivação impede abrir tokens já salvos; recadastre as credenciais ou planeje uma migração de chaves. Esta versão não faz rotação automática nem integra um KMS.

O arquivo registra substituições da configuração inicial do ambiente. Repositórios de `AIRE_TENANTS_JSON` e tokens de `githubTokenEnv` continuam sendo usados até existir uma substituição persistida. A exclusão explícita deixa um marcador que desativa a credencial do ambiente, evitando reativação acidental.

Todas as mutações verificam sessão, permissão e Origin. O tenant é obtido da sessão; os corpos das solicitações não aceitam tenant ou perfil. Respostas não incluem token nem conteúdo criptografado. O registro de auditoria contém ator, ação, revisão e fase `requested`, sem token ou nome da credencial; ele registra a intenção antes da gravação, não comprova conclusão de toda operação.

A coordenação de gravações é de uma única instância, consistente com o deployment de uma réplica. Múltiplas réplicas exigem armazenamento transacional compartilhado e coordenação distribuída.
