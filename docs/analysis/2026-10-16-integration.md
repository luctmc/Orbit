# Integração Home, contas e entrada em português — 2026-10-16

Integra as entregas h-43 (Accounts), h-44 (Home) e h-45 (voz/idioma), incluindo os componentes, estilos, protocolo, políticas de roteamento e recibos dos quais dependem. Desenvolvimento e ensaio real: Codex conta 2, `gpt-6.1-sol`, esforço `medium`.

## Comportamento

- Home abre diretamente Contas. Contas mantém identidades, login separado, modelos, quotas independentes, atualização de status e confirmação explícita de reset. Fixtures não consomem benefícios reais.
- Entrada humana no composer e no objetivo inicial passa por tradução isolada usando a assinatura Codex explicitamente escolhida. O payload inclui a instrução de responder em pt-BR. Não há troca silenciosa de conta/provedor; enviar original exige consentimento ou preferência global de inglês desligada.
- Rascunhos, IDs de anexos e identidade do envio pendente sobrevivem ao reinício do renderer no armazenamento local do app. “Conferir pedido” consulta o payload e requestId originais. URLs blob de prévias não são reutilizadas após reinício. ACK remove o rascunho e o pedido persistido.
- Agendamentos oferecem conta tradutora e consentimento para original. Cada execução automática usa journal com identidade estável pelo horário devido; execuções concorrentes se juntam, resultado incerto pausa a agenda, e exclusão/edição durante tradução impede lançamento do estado antigo.
- Objetivos traduzidos acima de 4.000 caracteres falham explicitamente, sem cortar silenciosamente o pedido nem iniciar um agente parcial.
- Ditado nativo/Web Speech solicita `pt-BR`. Texto inserido diretamente no terminal preserva o comportamento da CLI e passa sem tradução, com aviso no composer.

## Evidência

- `npm run typecheck`: protocolo, sidecar e desktop, exit 0.
- `npm test`: sidecar 306/306 e desktop 35/35, exit 0.
- `node --test scripts/*.test.mjs`: 6/6, exit 0.
- Home: 36 verificações UI; Accounts: 20; reinício de renderer: 8; zero erros JavaScript. Fixtures explícitas nas larguras 375/768/1024/1440, sem reset/login real.
- Regressões observadas antes da correção: reinício perdia o rascunho; agendamento lançava objetivo sem tradutor; tradução expandida era truncada. Cenários passaram após as correções.
- Fluxo real: composer português → WebSocket autenticado → tradutor real conta 2 → PTY/CLI Codex real conta 2 `gpt-6.1-sol/medium` → sessão nativa com prompt inglês e instrução pt-BR → resposta final em português. Uma tradução e um turno do agente. Diretório/auth isolados, sem ferramentas de edição, sem chamada de modelo Claude, sem geração de áudio. O ensaio usa `buildCommand`/perfil/PTY de produção, suprimindo apenas o turno inicial que conteria somente a instrução do papel.
- Exemplo enviado: “Explique em uma frase por que preservar os dados ao atualizar um aplicativo é importante. Não use ferramentas.” Inglês observado: “Explain in one sentence why preserving data when updating an application is important. Do not use tools.” Resposta final: “Preservar os dados ao atualizar um aplicativo evita a perda de informações importantes e permite que os usuários continuem suas atividades sem interrupções.”

Artefatos locais detalhados, não publicados por conterem inventário/caminhos do ambiente: `/Users/lucas/Documents/GitHub/Orbit/docs/analysis/2026-10-16-integration-evidence/`. Backup privado: `/tmp/orbit-integration-137-private/data-before.tar.gz` (diretório 0700, arquivo 0600). Nenhuma credencial foi incluída neste documento ou no Git.

## Integridade do bundle macOS

O archive oficial anterior 0.2.16 passou na assinatura Ed25519 do updater, mas o bundle extraído falhou em `codesign --verify --deep --strict` com “code has no resources but signature indicates they must be present”. São verificações independentes. `bundle.macOS.signingIdentity` agora fixa `-` para assinatura ad-hoc durante o empacotamento, antes da geração e assinatura do archive de atualização. O script de release também bloqueia publicação se `codesign --verify --deep --strict` falhar após o build. A chave original do updater não muda. A instalação final exige também verificar o codesign do bundle extraído do archive oficial intacto.

## Instalação e limites de aceitação

O integrador é o único responsável pela atualização da mesma `/Applications/Orbit.app`. Build local via `npm run app:build`; comparação integral de hashes do bundle/instalação, inode do executável mapeado e sidecar empacotado autenticado. O recibo final da instalação/release fica nos artefatos locais, porque a versão oficial é calculada automaticamente após merge e não corresponde necessariamente à versão-base do código-fonte.

O inventário inicial já continha zero missões; depois da atualização local continuou com dois workspaces, cinco contas e zero missões, sem mudança de configurações/identidades ou arquivos de credenciais. Mudança de estado observada apenas nas leituras de limites. O desaparecimento histórico das missões QA permanece de causa indeterminada. Não foi feita restauração nem limpeza de dados.

Microfone físico, captura de fala e reconhecimento real não foram testados. A inspeção do caminho nativo confirma o helper compilado, locale e descrições de permissão; uma consulta de permissão feita por ferramenta de diagnóstico não comprova autorização do bundle Orbit. Não foi gerado áudio.

O macOS negou Accessibility para automação e captura da janela nativa. Portanto Home/Contas foram inspecionados visualmente no preview/Chromium; execução nativa, bundle e contas foram conferidos pelo processo/sidecar, sem declarar navegação visual nativa concluída. Recuperação de rascunhos depende de armazenamento local disponível; armazenamento bloqueado/corrompido mantém apenas o estado da sessão. Pedidos com efeito incerto continuam exigindo conferência humana, sem reenvio automático. Idioma de resposta é uma instrução com uma execução real comprovada, não garantia universal de obediência dos modelos.

Não há evidência para uma nota “10/10”. Esses limites permanecem explícitos para a pessoa que valida o aplicativo.
