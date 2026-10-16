# Harness adaptativo: pesquisa de implementação — 16/10/2026

## Conclusão

Há projetos com implementação, testes e evidência pública suficientes para orientar o Orbit. Nenhum dos repositórios consultados comprova um orquestrador universal com 100% de confiabilidade, nem transfere automaticamente seus resultados para o par Claude/Codex instalado neste Mac. A recomendação é implementar no motor existente uma composição de capacidades e uma política conservadora de seleção baseada em medições próprias.

## Fontes fixadas e evidência

| Projeto | Revisão consultada | Evidência de funcionamento | Uso no Orbit e limite |
|---|---|---|---|
| [Deep Agents JS / LangChain](https://github.com/langchain-ai/deepagentsjs/tree/9f3bfd5529ef9df65158c609f6590f1127b56416) | `9f3bfd5529ef9df65158c609f6590f1127b56416`, MIT | [CI da revisão](https://github.com/langchain-ai/deepagentsjs/actions/runs/38476257091): testes unitários em Windows/Linux e Node 22/24, integração e build concluídos com sucesso. Executei cinco verificações locais diretamente nos módulos upstream de perfis, sem rede nem modelo. | Composição de perfil por provedor/modelo, contexto, ferramentas e middleware; garantias essenciais não podem desaparecer em overrides. Seus perfis ainda são configuração: não demonstram aprendizado automático de esforço por tarefa. |
| [Symphony / OpenAI](https://github.com/openai/symphony/tree/be10a1b79df723d6d7612b5651c8522704dafb2e) | `be10a1b79df723d6d7612b5651c8522704dafb2e`, Apache-2.0 | [make-all](https://github.com/openai/symphony/actions/runs/35029741093) passou; conferidos o orchestrator Elixir e os testes de reconciliação/retry, além da especificação. | Autoridade única de agendamento, claims, backoff e reconciliação antes de dispatch. O próprio README o classifica como preview experimental; não é prova de sandbox forte nem de retomada integral de todos os estados. Não executei a suíte Elixir neste Mac. |
| [Harbor](https://github.com/harbor-framework/harbor/tree/2de4605b9404eada7d341388291e6e469c90330b) | `2de4605b9404eada7d341388291e6e469c90330b`, Apache-2.0 | [Python Tests](https://github.com/harbor-framework/harbor/actions/runs/38830096500): verificações de runtime, agentes, rede Docker/Podman e Windows com sucesso. Inspecionados trial, resultado, adapters Claude/Codex e teste de verificador separado. | Separar tarefa, agente, ambiente, verificador e medição; fixar versão, modelo, esforço e checksum. Não executei containers nem benchmarks com provedores neste Mac. |
| [RouteLLM / LMSYS](https://github.com/lm-sys/RouteLLM/tree/0b64fdafe049e596a3f5657c219329f24af24198) | `0b64fdafe049e596a3f5657c219329f24af24198`, Apache-2.0 | Código de controller, routers e calibração inspecionado. Último commit consultado é de 2024 e não havia runs de CI na consulta. | Referência metodológica para calibrar custo/qualidade. Não adotar seus pesos, pares de modelos antigos ou percentuais de economia como resultado do Orbit. O controller avisa que seus routers foram treinados com primeiras mensagens; isso não certifica decisões em trajetórias longas de código. |

Os três CIs verdes acima são evidências upstream, não execuções locais do Orbit nem certificação de ausência de bugs. Popularidade não foi usada como substituto de inspeção de código/testes.

## Mecanismos inspecionados

### Composição, sem receita única

No Deep Agents JS, [`agent.ts`](https://github.com/langchain-ai/deepagentsjs/blob/9f3bfd5529ef9df65158c609f6590f1127b56416/libs/deepagents/src/agent.ts) resolve perfis de harness para o agente e os subagentes. [`merge.ts`](https://github.com/langchain-ai/deepagentsjs/blob/9f3bfd5529ef9df65158c609f6590f1127b56416/libs/deepagents/src/profiles/harness/merge.ts) combina exclusões por união e middleware por nome, preservando ordem. [`create.ts`](https://github.com/langchain-ai/deepagentsjs/blob/9f3bfd5529ef9df65158c609f6590f1127b56416/libs/deepagents/src/profiles/harness/create.ts) recusa excluir middleware essencial.

O smoke local sobre esses módulos conferiu: proteção de middleware obrigatório, união de exclusões, herança de defaults, substituição determinística na pilha e objeto de perfil congelado. Isso valida essas cinco propriedades, não o agente inteiro. O código foi consultado em uma pasta temporária; nenhuma dependência desses frameworks foi adicionada ao Orbit.

Para o Orbit, o princípio é combinar módulos de inspeção, reprodução, implementação, validação, revisão e recuperação conforme a atividade e o risco, mantendo permissão, orçamento e aceitação fora do controle adaptativo. A tabela editável continua sendo fallback e restrição humana, não uma alegação de modelo ótimo.

### Coordenação confiável

O [`orchestrator.ex`](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/elixir/lib/symphony_elixir/orchestrator.ex) mantém claims, concilia trabalho e aplica retry com limites. Os [testes](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/elixir/test/symphony_elixir/core_test.exs) cobrem remoção de elegibilidade, progressão de tentativas e timers velhos. O Orbit já tem identidade de atividade, época, leases e outbox duráveis; deve reforçá-los, sem substituir isso por uma cadeia de prompts.

### Benchmark como contrato verificável

O [resultado de trial](https://github.com/harbor-framework/harbor/blob/2de4605b9404eada7d341388291e6e469c90330b/src/harbor/models/trial/result.py) inclui checksum da tarefa, configuração, versão do agente, resultado do verificador, tempos e exceções. O [adapter Codex](https://github.com/harbor-framework/harbor/blob/2de4605b9404eada7d341388291e6e469c90330b/src/harbor/agents/installed/codex.py) trata reasoning effort como parâmetro da execução. É essa unidade conjunta — tarefa × harness × CLI/versão × modelo × esforço — que precisamos medir. Uma nota pública isolada do modelo não basta.

### Política aprendida com prudência

O [`controller.py`](https://github.com/lm-sys/RouteLLM/blob/0b64fdafe049e596a3f5657c219329f24af24198/routellm/controller.py) aplica um router e um limiar calibrado. O Orbit deve começar com seleção explicável baseada em observações, sem mais uma chamada de modelo em todo spawn: rejeitar dados simulados, inválidos, repetidos, antigos ou de outra versão; incluir falhas; exigir suporte amostral e limite inferior de qualidade; manter custo desconhecido como desconhecido. Sem evidência comparável, preservar fallback e informar a razão.

## O que não concluir desta pesquisa

- Não há prova de que instalar um pacote torna o Orbit confiável por si só.
- Testes upstream e smoke local não medem qualidade de Claude/Codex em tarefas privadas do usuário.
- “Aprender” não autoriza trocar permissões, iniciar modelos pagos, remover revisão ou repetir efeitos externos.
- Comparação econômica só vale com tarefas, versões, configurações e critérios equivalentes, contabilizando falhas e retrabalho.
- Autoadaptação inicialmente vale para novas tentativas. Uma execução viva só pode ser substituída depois de cancelamento/encerramento confirmado e nova admissão.
