# Etapa 2 no relatório

Branch companheira do motor: `codex/stage2-datadog-readiness`.

O painel fica abaixo da Etapa 1 na aba Mapa da jornada; mantém as duas abas existentes.
O histórico oferece relatórios consolidados sem sobrescrever o Markdown original.
A interface inicia simulações Commerce Lab explicitamente identificadas; não há dados
simulados produzidos em resposta a erro de conexão real.

Ações: iniciar avaliação, visualizar gaps, selecionar recomendações, informar tags
por lote/item, aceitar e revisar resumo, Executar selecionadas e retomar investigação.
O servidor valida sessão, origem, tenant, jornada e avaliação em cada operação.
Aceite e execução têm permissões distintas. O motor revalida versão aceita e tags.

`lib/server/readiness-api.ts` é o ponto de integração com a API do motor. Não altera
cadastro GitHub/GitLab nem o catálogo de Conexões. A futura conexão Datadog deve
configurar segredos de servidor por tenant, site, conta lógica, escopo e revisão;
esses valores nunca são aceitos como autoridade vindos do navegador.

Validação: TypeScript, 100 testes (incluindo quatro novos de autorização/isolamento),
lint dos novos arquivos. Não houve validação visual em navegador ou implantação.
Para habilitar a simulação, instalar também o overlay/configuração da branch do motor.
O painel mostra a cobertura de logs/spans, eventos relacionados, janela efetiva e
análise dos monitores em detalhes expansíveis. Ausência no período não é apresentada
como ausência de instrumentação. Regras de monitores reais são configuradas por política
versionada no servidor; a edição visual da política permanece pendente.

A main do front já era ancestral da branch. Foi preservada a correção remota que exige
preenchimento explícito da tag de jornada (nenhum valor pré-selecionado). Sem deploy.
