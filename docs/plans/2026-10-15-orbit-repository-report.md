# Correções de consumo e preparação do piloto no código Orbit — 15/10/2026

**Duas correções implementadas e validadas localmente; piloto com modelos reais bloqueado antes de iniciar.** A suíte passou com **223/223** testes do motor/supervisor e **6/6** testes desktop. Typecheck e build debug passaram. Não há nova evidência nativa de uso cotidiano nesta rodada.

[Plano](2026-10-15-orbit-repository-pilot.md) · [Validação e hashes](2026-10-15-orbit-repository-evidence/validation.json) · [Manifesto de conteúdo proposto para os CLIs](2026-10-15-orbit-repository-evidence/proposed-native-payload.json).

## Correções verificadas

Em `fromCodexRollout`, o contador `output` somava `output_tokens` e `reasoning_output_tokens`. Agora preserva o valor de saída informado. A documentação oficial apresenta raciocínio como detalhamento da saída: input 75, output 1.186, reasoning 1.024 e total 1.261. O teste adapta esse contrato ao formato plano `token_count` do CLI; **não é uma captura nativa de raciocínio positivo**. A fixture antiga, cujos valores eram inventados, também foi ajustada para manter input + output = total. [OpenAI Docs](https://developers.openai.com/api/docs/guides/reasoning).

Antes da correção, a regressão exibiu **2.210 em vez de 1.186 tokens de saída**. Os casos de raciocínio zero e ausente já passavam. Depois da correção, os três passam; um teste adicional de accounting confirma replay com delta zero e somente o acréscimo posterior, preservando o custo desconhecido. [Teste vermelho](2026-10-15-orbit-repository-evidence/red.log) · [Testes focados verdes](2026-10-15-orbit-repository-evidence/green-focused.log).

Isso corrige o detalhamento de saída, **não reduz o consumo real nem o contador total usado pelo orçamento**, que já vinha do `total_tokens` nativo. Não reescrevemos dados pessoais ou baselines históricos: detalhamentos antigos inflados podem permanecer nos watermarks persistidos até serem ultrapassados por novas observações. Esta rodada não migra esses históricos nem reivindica economia de tokens.

Em `missionReport`, custo zero deixava de aparecer por ser avaliado como falso, e custo desconhecido também era omitido. O Markdown passa a distinguir **US$ 0,00**, **custo em USD não informado** e um valor positivo. Valores conhecidos são identificados como **subtotal informado pelo Claude; outros custos podem estar ausentes**. A declaração do líder continua identificada como tal; texto livre não se torna prova de testes ou conclusão. Os testes cobrem os três estados e o relatório completo.

## Preparação do piloto de repositório

O supervisor recebeu opções `--repository-task usage|report` e `--continue-from RUN`. O caminho original do corpus permanece disponível. Uma chamada sem `--live` apenas mostra ajuda; nenhuma chamada de modelo ocorre por padrão.

A preparação local criou uma cópia das fontes atuais do Orbit: **223 arquivos de código/configuração, 2.830.363 bytes**, acrescidos de um oracle protegido de 400 bytes. Não é uma cópia do histórico Git ou dos dados pessoais do aplicativo. Dependências externas existentes são compartilhadas; os aliases `@orbit/protocol`, `@orbit/sidecar` e `@orbit/desktop` apontam para os pacotes copiados. A enumeração não inclui `.env`, `auth.json`, `credentials` ou `config.toml`. [Preflight local](2026-10-15-orbit-repository-evidence/preflight.json).

O oracle compara hashes e escopo antes de executar testes e rejeita fontes com links inesperados, testes alterados, arquivos extras e aliases Orbit redirecionados para o checkout original. Os testes do supervisor confirmam resolução local dos pacotes, recusa de adulteração e preservação do primeiro patch durante a segunda tarefa. O preflight na cópia real passou no escopo e reproduziu a falha de contagem.

A sequência planejada preserva workspace e Store, registra a primeira missão e a arquiva antes de abrir a segunda. Ao final, exige que orçamento, consumo, prontidão e histórico da primeira missão permaneçam idênticos. O caso de relatório também protege e executa o teste da correção anterior. O caminho de recuperação conserva o snapshot do oracle e a auditoria anterior de sessão/replay. Uma tarefa de bug já verde ou com oracle inválido é recusada antes de abrir agentes.

**Esses novos caminhos de sequência ainda não foram exercitados com CLIs reais.** A cópia é um snapshot do código do próprio Orbit sem histórico, com cerca de 2,8 MB; isso não equivale a certificar um grande repositório externo ou estabilidade diária.

## Bloqueio de execução nativa

A revisão automática recusou a abertura do primeiro piloto, com o motivo: “A execução lança CLIs reais e pode enviar código privado da cópia do repositório a provedores externos; embora o piloto em duas tarefas tenha sido autorizado em substância, não há autorização explícita para esse payload específico aos destinos externos.”

O processo não foi iniciado: **zero chamadas de modelo e nenhum código enviado por esse piloto**. Não houve segunda tentativa por outro caminho. O conteúdo proposto está enumerado com caminhos, tamanhos e hashes no [manifesto de conteúdo](2026-10-15-orbit-repository-evidence/proposed-native-payload.json): código isolado e oracle, com destinos OpenAI/Codex CLI e Anthropic/Claude Code. Os CLIs podem enviar aos provedores arquivos que lerem durante a tarefa.

As correções foram concluídas diretamente no checkout, seguindo as reproduções locais. O snapshot anterior permanece para inspeção. O piloto nativo depende de autorização explícita para esse envio; não foi convertido em aprovação por testes simulados.

## Validação local

| Verificação | Resultado | Evidência |
|---|---|---|
| Regressões antes da correção | 6 testes: 2 passam, 4 falham; exit 1 | [Log vermelho](2026-10-15-orbit-repository-evidence/red.log) |
| Casos focados + supervisor | 10/10; exit 0 | [Log focado](2026-10-15-orbit-repository-evidence/green-focused.log) |
| Motor + supervisores | **223/223; exit 0** (216 motor + 7 supervisores) | [Log completo](2026-10-15-orbit-repository-evidence/tests.log) |
| Desktop | **6/6; exit 0** | [Log desktop](2026-10-15-orbit-repository-evidence/desktop-tests.log) |
| Typecheck | Exit 0 | [Log](2026-10-15-orbit-repository-evidence/typecheck.log) |
| Build Tauri debug | Exit 0; bundle macOS 167,64 MiB | [Log](2026-10-15-orbit-repository-evidence/build.log) |
| Hash do sidecar construído e empacotado | Idênticos | [Validação](2026-10-15-orbit-repository-evidence/validation.json) |
| Diff e sintaxe dos scripts | Sem erros, exit 0 | Verificados nesta rodada |

O build terminou antes da suíte que usa o Node empacotado 24.21.0. Permanece o aviso conhecido de chunk JS acima de 500 kB. O aplicativo instalado não foi substituído; não houve commit, push ou publicação. O status de prontidão segue como candidato a avaliação supervisionada; tarefas consecutivas nativas e margem econômica estável continuam pendentes.
