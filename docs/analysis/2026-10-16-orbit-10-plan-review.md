# Revisão do plano ORBIT 10/10 — 16/10/2026

**Parecer:** boa estrutura de trabalho, mas recomendo revisar os pontos abaixo antes da execução integral. O nome 10/10 é uma meta; cumprir testes finitos não certifica segurança universal nem confiabilidade em todo repositório. Esta revisão não implementa os 66 itens nem altera o plano original.

## O que foi conferido

- Leitura do [plano completo](../plano-orbit-10.md), confronto dos mecanismos propostos com o código atual e reprodução local dos dois contraexemplos de fingerprint descritos abaixo.
- Contagem: 14 R, 22 V, 22 P, 3 O e 5 T, **66 IDs únicos**, todos presentes em pelo menos um dos **21 pacotes de trabalho**. Isso confirma cobertura nominal, não valida por si só a ordem ou a eficácia de cada solução.
- Suíte atual do motor: **225/225**, sem falhas, skips ou TODOs, exit 0; Node 24 empacotado e `--test-concurrency=4`. O número citado no plano está correto para a suíte do sidecar.
- `npm run typecheck`: exit 0. A primeira tentativa dos testes no sandbox não pôde abrir servidores localhost (`listen EPERM`); a execução autorizada com esse acesso passou. Não houve execução de tarefa com modelo ou envio de código a provedores nesta revisão.
- As áreas novas `readOnlyGuard`, `limitWatch`, watchdog, corpus de roteamento e CI não estão presentes nos caminhos propostos. A declaração de escopo do documento — planejamento, não implementação — é coerente com essa conferência. Não foi feita uma auditoria de conclusão item a item das 66 mudanças.

## Achados prioritários

### 1. [P1] V4 não garante somente leitura com uma lista de comandos

[Plano, linha 405](../plano-orbit-10.md:405). A proposta detecta certos comandos de escrita e permite, entre outros, `npm test` e `node --test`. Esses comandos executam código arbitrário do projeto, que pode escrever no checkout. Um script existente chamado com `node script.mjs` também não precisa conter `writeFile` na linha de comando. Liberar qualquer diretório ignorado por Git amplia essa lacuna: `.gitignore` não é uma fronteira de permissão.

**Ajuste:** impor a política no acesso ao filesystem/processo, com sandbox compatível, cópia isolada ou execução de comandos por um serviço com escopo definido. Caso o provedor não suporte a restrição exigida, recusar esse assento ou declarar a limitação. O filtro pode ser defesa adicional, mas os 24 exemplos propostos não provam a garantia da seção 1.

### 2. [P1] R2 transformaria erro transitório em limite de assinatura inventado

[Plano, linha 147](../plano-orbit-10.md:147). O mesmo tratamento marca `usedPercent=100` ao observar `usage_limit`, `429` ou `overloaded`. Uma mensagem de overload ou um limite momentâneo de requisições não comprova esgotamento da janela de assinatura nem fornece necessariamente um reset. Isso pode contaminar o indicador e afastar contas saudáveis.

**Ajuste:** separar quota confirmada, cooldown transitório, indisponibilidade e erro de autenticação. Manter o último percentual confirmado e sua origem. Persistir deduplicação e cooldown de failover. Antes de abrir outro writer, exigir encerramento confirmado da tentativa antiga, liberação do lease e nova tentativa com a mesma atividade; testar crashes entre esses passos e preservar as restrições de ferramenta/conta.

### 3. [P1] V8 permite que código mude sem alterar o fingerprint

[Plano, linha 476](../plano-orbit-10.md:476). Reproduzi em arquivos temporários:

- Arquivo de 33 MiB: alterar um byte no meio, preservando tamanho e mtime, mantém o hash dos primeiros/últimos 1 MiB. O conteúdo completo mudou e a impressão proposta não mudou.
- Modo degradado: trocar o conteúdo não commitado de uma linha de `bbb` para `ccc` preserva HEAD, index e `git diff --stat`. A impressão proposta também não mudou.

**Ajuste:** usar hashing completo por streaming, snapshots imutáveis ou evidência baseada em blobs que cubra todo conteúdo relevante. Submódulos precisam incluir alterações locais, não apenas o commit HEAD. Se só houver evidência parcial/degradada, ela não deve autorizar aceite automático como revisão completa. Tornar a leitura assíncrona também é necessário para não bloquear o motor.

### 4. [P2] R4 pode promover uma conta conhecida como cheia para 50%

[Plano, linha 181](../plano-orbit-10.md:181). Substituir qualquer leitura com `refreshError` por 50 pode baixar uma última observação de 98 para 50, permitindo nova admissão sob o limiar de 85. A ausência de informação pode assim melhorar a classificação de uma conta.

**Ajuste:** distinguir valor observado de estado de disponibilidade; nunca reduzir uma evidência de saturação por falha de refresh. Pedir nova leitura antes da admissão automática, ou aplicar regra conservadora explícita. Acrescentar o caso “98%, refresh falhou, não admitir como 50%”. Harmonizar a validade de roteamento com os estados de validade já expostos na interface.

### 5. [P2] V22 ainda invalida mudanças independentes pelo HEAD/index globais

[Plano, linha 682](../plano-orbit-10.md:682). A proposta compara apenas os caminhos tocados, **mais HEAD e index**. Um writer posterior que commitou ou adicionou ao index um arquivo independente muda essas referências globais e continua invalidando o primeiro resultado. O teste proposto precisa cobrir essa situação, além de uma edição não adicionada ao index.

**Ajuste:** vincular o resultado a conteúdo/estado dos caminhos relevantes, com exclusões e dependências explícitas; reservar o snapshot global para a revisão de integração. Preservar tombstones de arquivos removidos. Em V6, esclarecer também que ignorar artefatos do revisor não autoriza ignorar mudanças no código efetivamente analisado por uma atividade somente leitura.

### 6. [P2] A Fase 0 tem uma espera circular de merge

[Plano, linha 1144](../plano-orbit-10.md:1144), [WP 0.2 e 0.3](../plano-orbit-10.md:1157). A regra geral exige que o predecessor esteja em `main` antes de iniciar o sucessor. A WP 0.3 espera 0.2, mas 0.2 só pode entrar em `main` junto de 0.3.

**Ajuste:** declarar uma branch de integração para 0.2+0.3 e uma entrega conjunta, ou disponibilizar `integrate` antes de fechar a escrita por Bash. Fazer a verificação mecânica considerar restrições de merge atômico, não só dependências dos itens.

### 7. [P2] T5 admite uma versão Node incompatível com o projeto

[Plano, linha 1109](../plano-orbit-10.md:1109). O fallback “ou 22” não satisfaz `engines.node >=24.11` e não corresponde ao runtime usado para os arquivos TypeScript deste repositório.

**Ajuste:** fixar uma versão 24 suportada no CI, testar macOS/Linux e instalar corretamente dependências nativas. Tornar o check obrigatório é uma configuração do repositório, além da criação do YAML; a prova precisa incluir a regra de proteção.

### 8. [P2] R13 omite a camada que descarta outros buckets Codex

[Plano, linha 327](../plano-orbit-10.md:327). Alterar só `accountLimits.ts` não basta: `packages/sidecar/hooks/read-codex-limits.mjs` hoje encaminha apenas `rateLimitsByLimitId.codex`. Os demais buckets não chegam ao parser. Também é necessário provar como cada limitId corresponde ao modelo pretendido, sem supor que qualquer bucket seja um modelo.

**Ajuste:** incluir transporte, declaração de tipos e testes do reader no mapa de arquivos da WP 2.1. Validar o contrato real do provedor e manter a lista de campos permitidos sem identidade, créditos ou credenciais desnecessários.

## Lacunas adicionais para uso como ambiente principal

- **Inicialização do motor:** a demora de vários minutos observada nesta conversa precisa de item próprio e gate de latência. `startServer` espera `resumeCrews` antes de devolver o handshake, e leituras síncronas de diretório/Git podem impedir o timer de watchdog de rodar. O1 verifica ajudantes e não resolve esse bloqueio do próprio motor. Prever UI conectada com progresso, I/O fora da thread principal, prazos e cancelamento sem perder sessões.
- **Conclusão sem resultado de código:** P11 precisa testar explicitamente missão sem alterações, cancelamento pelo usuário e squad de auditoria isento. Retirar `mission_ready` normal exige um caminho definido para os casos em que não há um `resultId` elegível para a inspeção de integração.
- **Economia comprovada:** T4 deve comparar tarefas e versões fixas, incluir falhas/retrabalho, tokens de entrada/saída/cache, custo conhecido/desconhecido e latência. Reduzir caracteres de prompt e número de ferramentas é útil, mas não prova redução do gasto total nem aumento de acerto. Reservar casos fora do corpus de ajuste para evitar medir apenas memorização das 40 atividades.
- **Dados persistidos e migração:** as mudanças de ferramentas, campos, filas e estados precisam de versão/migração, rollback e compatibilidade com sessões em andamento. V16 protege uma versão desconhecida, mas não substitui um plano de migração das novas estruturas.

## Sequência recomendada

1. Resolver os achados de segurança, quota e fingerprint neste documento; corrigir a dependência de merge e o runtime do CI.
2. Acrescentar os gates de inicialização, migração e métricas econômicas.
3. Executar a Fase 0 em um conjunto de mudanças revisável, mantendo o app de uso separado até os gates locais e nativos passarem.
4. Prosseguir com ciclo de vida e roteamento; otimizar prompts com comparação de resultados e consumo.

As fases de implementação ainda exigem seus testes vermelhos antes da correção. Os 225 testes verdes confirmam a base atual, não demonstram que os defeitos auditados no plano já foram resolvidos.
