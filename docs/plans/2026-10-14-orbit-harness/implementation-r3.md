# R3 — contexto por seção e skills sob demanda

Implementado no checkout em 14/10/2026, preservando as alterações anteriores. O build de desenvolvimento inclui os pacotes; o aplicativo instalado não foi substituído. R4–R6 continuam pendentes.

## Comportamento

O briefing deixou de cortar indiscriminadamente o texto após 18.000 caracteres. O orçamento agora é de 18.000 bytes UTF-8 por briefing, 48.000 por papel e 128.000 por tarefa. Objetivo, instruções do usuário, memória fixada ou escrita pelo usuário, decisões da missão, pendências com critérios de aceite, responsáveis, branches e contrato de continuação permanecem completos. Se o obrigatório e as referências não couberem, o motor recusa gerar um contexto parcial e informa o limite. Isso pode impedir uma troca de líder em missões com contrato muito grande; não existe aumento automático nem painel para configurar esses limites nesta etapa.

Histórico opcional, memória de missões anteriores, resultados e conversa anterior podem ser substituídos por referências. O original da seção fica em snapshot privado, identificado por SHA-256 e restrito à missão. `context_read` lê páginas com `offset`/`nextOffset` em unidades UTF-16, sem resolver caminhos fornecidos pelo agente. Hash, cursor, limite e missão são conferidos; referências sobrevivem à reabertura do processo e são removidas ao excluir a missão. Cada seção é preservada integralmente ou referenciada, sem resumir suas evidências por modelo. Não há garantia contra perda de energia no filesystem, nem coleta automática de versões antigas enquanto a missão existir.

A tarefa também deixou de sofrer o corte em 20.000 caracteres depois de anexar o aceite. Um teste usa tarefa com 19.999 caracteres e confirma que os critérios no final chegam completos ao arquivo de lançamento. Cada execução não shell recebe `context.json` privado com texto, hashes, tamanhos e referências de papel/tarefa. Esse manifesto pertence ao lançamento; não substitui o ledger de atividades nem uma avaliação de conformidade.

## Pacotes e descoberta

Cinco pacotes originais em `packages/sidecar/resources/skills`: `orbit-pilot`, `orbit-build`, `orbit-review`, `orbit-research` e `orbit-verify`. O manifesto registra versão 1.0.0, papel, compatibilidade com a leitura de recursos nos quatro adapters, SHA-256 e bytes. Essa compatibilidade não é certificação de todos os recursos nativos dos provedores. O build valida o manifesto antes de copiar os recursos. Os hashes das cinco skills no `Orbit.app` gerado foram comparados ao source.

O catálogo conserva a descoberta pessoal, sistema, projetos e plugins Claude pelo registro já reconhecido. Acrescenta skills de projeto Codex em `.agents/skills` e `.codex/skills`. Não implementa descoberta universal de todos os formatos de plugin Codex. Descoberta lê metadados e conteúdo para calcular o hash; não executa scripts nem injeta o corpo das skills nos agentes. O probe existente `codex mcp list --json` continua sendo usado para metadados de servidores MCP.

Arquivos de skill são limitados a 64 KiB. Links que escapam da raiz registrada são ignorados. Recursos de outro workspace não aparecem nos tools da missão. Não foi feita instalação global ou alteração de perfis pessoais. Pacotes `orbit-*` distribuídos pelo app têm precedência sobre homônimos externos no catálogo de recursos do Orbit.

## Ferramentas e estados

- `skill_catalog`: metadados elegíveis para CLI, missão e papel atuais; páginas de até 50 itens e cursor vinculado ao catálogo e à execução. Alteração de conteúdo descoberto, política ou itens elegíveis invalida o cursor. Arquivos externos novos ou alterados exigem nova varredura pela interface.
- `skill_load`: seleciona e serve o texto pelo `id` e hash exatos. Confere novamente raiz, conteúdo, desativação e `onlySkills`; não executa recursos. Um conteúdo alterado exige redescoberta.
- `context_read`: consulta referências da missão, com hash e paginação, sob a mesma proteção de epoch/tentativa dos outros tools.
- `handoff_list`: acrescenta `view=summary` para descoberta compacta e `view=detail` com `resultId` para evidência. O retorno completo padrão foi preservado para clientes existentes; `after` continua funcionando. A combinação ambígua de `resultId` e `after` é recusada.

Os estados são explícitos: **disponível**, **selecionada** e **carregada** são fatos distintos. Carregada significa somente que o Orbit serviu o texto; não confirma consumo do CLI. `fulfilled` continua `null`: o agente não pode transformar uma declaração em conformidade comprovada. O registro por epoch não é herdado pela execução seguinte e é limpo ao fechar o terminal. Uma nova consulta após reiniciar o processo lê o registro salvo quando aquele registro ainda existe; retomar um agente cria outro epoch.

O papel sugere uma skill própria conforme função/tipo de tarefa, respeitando `onlySkills`. Não pré-carrega corpos e não garante invocação automática do CLI. A capacidade de ocultar o catálogo nativo continua desconhecida (`null`); os gates de hook/sandbox existentes permanecem separados do controle dos recursos MCP.

## Medida reproduzível

`node scripts/measure-context.mjs` produz [context-bytes.json](execution-r3/context-bytes.json). Compara material opcional carregado integralmente com o pack atual, usando um corpus sintético e os prompts atuais. Não é uma comparação histórica R2/R3 nem avaliação de qualidade.

| Caso | Material integral | Contexto inicial | Redução inicial |
|---|---:|---:|---:|
| Líder sem memória | 7.969 B | 7.969 B | 0% |
| Líder com memória curta | 8.223 B | 8.223 B | 0% |
| Líder com histórico longo | 26.558 B | 8.156 B | 69,29% |
| Revisor | 2.729 B | 2.729 B | 0% |

No caso longo, ler todas as referências resulta em 26.743 bytes de material, antes do envelope dos tools: maior que a versão integral. O benefício depende de detalhes realmente desnecessários ficarem sem leitura. Catálogos nativos, schemas MCP adicionais, tokenização, uso de cache, chamadas de consulta e comportamento dos modelos estão fora dessa medida. **Economia real de tokens e manutenção da qualidade ainda não foram medidas.** A mediana dos quatro casos é 0%; a meta de redução mediana do roteiro não está comprovada.

## Evidência e limites

- `npm test`: **152/152 sidecar + 2/2 desktop**, exit 0; [log completo](execution-r3/tests.log).
- `npm run typecheck`: exit 0; [log](execution-r3/typecheck.log).
- Node incluído no app, **24.21.0**: **24/24** testes focados, exit 0; [log](execution-r3/node24-tests.log).
- `npm run tauri -w @orbit/desktop -- build --debug`: exit 0; [log](execution-r3/build.log). Permanece o aviso preexistente do chunk JavaScript de 747,67 kB.
- Cinco pacotes e 20 recursos por adapter conferidos dentro do bundle: [bundle-skills.json](execution-r3/bundle-skills.json).
- `git diff --check`: exit 0. [Índice de hashes](execution-r3/validation.json) identifica fontes, testes, recursos e logs verificados.

A regressão do corte foi observada antes da correção: `contextIntegration.test.ts` falhou com `Missing expected exception` ao gerar briefing de contrato obrigatório maior que o limite. Depois passou com recusa explícita. A primeira suíte completa encontrou uma expectativa antiga sobre a posição do cabeçalho da memória; foi ajustada para as novas seções obrigatória/opcional, mantendo as verificações dos textos e da ordem das entradas. O [log dessa rodada](execution-r3/tests-first-run.log) foi conservado. A verificação também levou à preservação explícita de notas fixadas e notas do usuário.

O validador Python `skill-creator/scripts/quick_validate.py` foi tentado, mas o Python disponível não tem PyYAML (`ModuleNotFoundError: yaml`). Não foram instaladas dependências globais. Os testes e o build verificam nomes/frontmatter obrigatório, manifesto, hashes e leitura dos pacotes; isso não equivale a um teste comportamental das skills com modelos reais.

Nesta etapa não houve chamadas pagas a modelos. O cenário completo Claude implementando → Codex revisando, e depois invertido, permanece pendente, assim como validação independente ligada ao diff (R4), avaliação A/B (R5) e integração do visual/mascote ao domínio (R6). O build gerado ainda não é uma declaração de pronto para uso diário.
