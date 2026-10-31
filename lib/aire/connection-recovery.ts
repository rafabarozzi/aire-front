export type ConnectionRecovery = {
  title: string;
  owner: string;
  steps: string[];
  link?: { label: string; href: string };
  credential?: boolean;
  signIn?: boolean;
};

const tokenLink = {
  label: "Criar credencial no GitHub",
  href: "https://github.com/settings/personal-access-tokens/new",
};

export function connectionRecovery(code: string): ConnectionRecovery {
  switch (code) {
    case "github_unconfigured":
      return {
        title: "Configure a conexão com o GitHub",
        owner: "Administrador ou responsável pelas conexões",
        steps: [
          "No GitHub, crie um fine-grained personal access token. Em Resource owner, selecione o proprietário do repositório.",
          "Em Repository access, escolha Only select repositories e selecione este repositório. Em Repository permissions, conceda Contents: Read-only; mantenha Metadata: Read-only.",
          "Defina uma validade, gere o token e, no AIRE, abra Conexões → Cadastrar credencial. Informe um nome, cole o token e salve.",
          "Volte a esta tela e clique em Tentar novamente. O repositório e a revisão serão preservados.",
        ],
        link: tokenLink,
        credential: true,
      };
    case "credential_encryption":
      return {
        title: "Recadastre a credencial protegida",
        owner: "Administrador da implantação e responsável pelas conexões",
        steps: [
          "A credencial salva não pôde ser aberta. Peça ao administrador para conferir a chave de proteção configurada no servidor.",
          "Se a chave foi alterada, abra Conexões → Editar credencial e informe novamente um token válido. A chave anterior é necessária para recuperar o valor já salvo.",
          "Salve a credencial e tente validar a conexão novamente.",
        ],
        credential: true,
      };
    case "github_credentials":
      return {
        title: "Atualize a credencial do GitHub",
        owner: "Administrador ou responsável pelas conexões",
        steps: [
          "Confira se o token configurado expirou, foi revogado ou foi copiado de forma incompleta.",
          "Gere uma credencial válida com Contents: Read-only para este repositório. No AIRE, abra Conexões → Editar credencial, informe o novo token e salve.",
          "Tente validar a conexão novamente.",
        ],
        link: tokenLink,
        credential: true,
      };
    case "repository_not_allowed":
      return {
        title: "Autorize o repositório para este workspace",
        owner: "Administrador ou responsável pelas conexões",
        steps: [
          "Confirme que você está no workspace correto e que o nome do repositório está certo.",
          "Em Conexões → Novo repositório, cadastre organização/repositório neste workspace. É necessário ter a permissão Gerenciar repositórios e credenciais.",
          "Depois do cadastro, tente validar a conexão novamente.",
        ],
      };
    case "github_sso":
      return {
        title: "Autorize a credencial na organização GitHub",
        owner: "Proprietário da credencial e administrador GitHub",
        steps: [
          "Entre na organização GitHub pelo SSO corporativo.",
          "Confira a autorização SSO da credencial e, para um fine-grained token, se a aprovação da organização está concluída.",
          "Após a liberação, volte aqui e tente novamente.",
        ],
        link: {
          label: "Abrir credenciais do GitHub",
          href: "https://github.com/settings/tokens",
        },
      };
    case "github_forbidden":
      return {
        title: "Revise as permissões no GitHub",
        owner: "Proprietário da credencial e administrador GitHub",
        steps: [
          "Confira se a credencial permite este repositório e possui Contents: Read-only.",
          "Verifique aprovação pendente, exigência de SSO e restrições de rede da organização. Uma resposta 403, sozinha, não identifica qual política bloqueou o acesso.",
          "Após corrigir a permissão ou política, tente novamente.",
        ],
        link: {
          label: "Revisar credenciais",
          href: "https://github.com/settings/personal-access-tokens",
        },
      };
    case "repository_unavailable":
      return {
        title: "Confira o repositório e seu acesso",
        owner: "Solicitante e administrador GitHub",
        steps: [
          "Confira organização/repositório e se o repositório foi renomeado ou removido.",
          "Peça ao administrador para conferir o acesso da credencial a esse repositório privado. O GitHub também retorna 404 quando a credencial não pode enxergá-lo.",
          "Corrija a URL ou a permissão e tente novamente.",
        ],
      };
    case "revision_unavailable":
      return {
        title: "Confira a branch ou o commit",
        owner: "Solicitante e administrador GitHub",
        steps: [
          "O repositório foi localizado, mas a revisão não pôde ser consultada. Confira o nome da branch ou o SHA do commit.",
          "Você pode deixar a revisão vazia para usar a branch padrão. Se persistir, confira Contents: Read-only na credencial.",
          "Tente validar novamente com a revisão corrigida.",
        ],
      };
    case "github_rate_limited":
      return {
        title: "Aguarde o limite de consultas do GitHub",
        owner: "Solicitante",
        steps: [
          "Aguarde alguns minutos antes de tentar novamente. Evite novas tentativas em sequência.",
          "Se o limite persistir, peça ao administrador para verificar outras integrações que usam a mesma credencial.",
        ],
      };
    case "repository_format":
    case "validation":
    case "revision":
      return {
        title: "Revise os dados informados",
        owner: "Solicitante",
        steps: [
          "Informe https://github.com/organizacao/repositorio ou organizacao/repositorio, sem caminhos de arquivos, parâmetros ou credenciais na URL.",
          "Informe a branch ou o commit no campo separado e tente novamente.",
        ],
      };
    case "unauthenticated":
      return {
        title: "Entre novamente no AIRE",
        owner: "Solicitante",
        steps: [
          "Sua sessão não está válida. Entre novamente para continuar a validação.",
        ],
        signIn: true,
      };
    case "forbidden":
    case "membership":
      return {
        title: "Solicite acesso no AIRE",
        owner: "Administrador do workspace",
        steps: [
          "Peça ao administrador para conferir seu vínculo com a organização e sua permissão de mapear jornadas.",
          "Depois da liberação, tente novamente.",
        ],
      };
    default:
      return {
        title: "Tente a conexão novamente",
        owner: "Solicitante e administrador da implantação",
        steps: [
          "A validação não foi concluída. Aguarde um momento e tente novamente.",
          "Se o erro persistir, peça ao administrador para verificar a disponibilidade do AIRE e a saída de rede para api.github.com. Uma falha temporária não exige recriar a credencial.",
        ],
      };
  }
}
