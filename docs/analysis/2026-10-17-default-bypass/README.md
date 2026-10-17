# Bypass padrão do Orbit

Base isolada: origin/main 117052f5840b3e0bb92f413844f9cfca417926ab (PR #53, visual da v0.2.22). O checkout original com alterações de terceiros foi preservado.

Claude Code 2.1.302: `--dangerously-skip-permissions` em cada abertura/retomada. Codex CLI 0.163.0: `--dangerously-bypass-approvals-and-sandbox` em cada execução gravável. As opções são documentadas pelas CLIs locais, inclusive `codex resume --help`; cópias dos helps nesta pasta. Login e outros provedores permanecem iguais. Não há alteração de configuração/credenciais globais. O padrão persiste por ser aplicado em toda construção de comando, inclusive panes existentes reabertos e recuperação após reiniciar Orbit.

Papéis explicitamente somente leitura mantêm o sandbox Codex `read-only`, com `-a never`: operações proibidas falham sem pedir aprovação. Hooks de orçamento, somente leitura e coordenação permanecem ativos. O bypass não altera essas regras da missão nem políticas administrativas das CLIs.

Validação: 311 testes sidecar aprovados (incluem restart/recuperação, comandos, configurações e transmissão dos argumentos pelo wrapper MCP sem alterar PID/segredos); 37 testes desktop; 6 testes dos scripts; typecheck de todos os workspaces. A suíte primeiro apontou 4 expectativas antigas de argumentos; foram atualizadas para o contrato solicitado e a suíte completa passou. Não foram realizadas chamadas pagas de inferência nem comandos destrutivos para testar permissões.

A prévia sintética do visual integrado foi novamente testada: 55 verificações Chromium e 55 WebKit, 375–1920 px, sem erros. ui-*.json, terminal-*.png e focus-*.png contêm as evidências novas. Prévia aberta no browser do Overclock em http://127.0.0.1:5387 (fixture, sem perfil ou credenciais). Não existe referência atual comprovada do Overclock para afirmar fidelidade pixel a pixel.

skills: inline [oc-showcase].

## Instalação local final

Build local 0.2.23 concluído, /Applications/Orbit.app atualizado uma única vez de 0.2.22 para 0.2.23, assinatura ad hoc verificada com `codesign --verify --deep --strict --all-architectures`. Os 63 arquivos do bundle instalado são idênticos aos do build. 1158 arquivos privados (estado/contas/configurações/credenciais existentes) mantiveram seus hashes durante a troca; nenhum diretório de dados foi apagado/recriado. O código fonte continua a versão-base 0.2.15, conforme convenção do workflow: os cinco arquivos de versão foram ajustados apenas para o build e restaurados depois. A próxima release automática calcula 0.2.23 após v0.2.22.

Runtime: Orbit reaberto, executável mapeado pelo inode instalado e sidecar empacotado confirmados via processo e WebSocket autenticado, sem mensagens de mutação. Snapshot preserva 2 workspaces, 3 missões, 3 panes e 5 contas; Claude/Codex continuam autenticados. MCP sem token responde 401. A primeira leitura ocorreu antes do sidecar iniciar e falhou; a leitura seguinte confirmou o runtime, registrada em installed.json. Não houve nova instalação.

Limites: assinatura local ad hoc (sem notarização Apple); inferência real não exercitada; UI nativa não automatizada nesta revisão. A prévia sintética ficou aberta no pane-170; navegação automática dentro desse browser foi recusada porque decisões automáticas JEV estão desligadas, mas os testes independentes Chromium/WebKit abriram e validaram a missão.
