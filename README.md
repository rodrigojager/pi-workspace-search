# Pi Workspace Search

Busca de evidências com saída limitada para reduzir o conteúdo que chega ao modelo principal do [Pi](https://github.com/earendil-works/pi). A extensão executa o fluxo internamente, sem um agente generativo intermediário.

```text
Literal/regex → ripgrep incluído no pacote
Conceito      → zvec local com índice existente, se disponível
              → Jev/TypeSafe, se o resultado local não servir ou o backend falhar
              → agente principal explora quando as evidências ainda não bastarem
```

O zvec é opcional e recomendado. Sua ausência não impede a instalação nem a busca com Jev. Busca local não usa tokens de API; embeddings locais consomem CPU/memória. Jev usa uma API de classificação paga conforme o serviço: não é apresentado como gratuito. A economia no modelo principal depende da consulta, do tamanho dos trechos e das buscas necessárias; não há percentual prometido.

## Instalação

Requer **Pi 1.0+** com os pacotes `@earendil-works` e o classificador TypeSafe no catálogo, Node.js 22+ e npm. Versões antigas do Pi com `@mariozechner` não são compatíveis com esta versão. Não precisa instalar sgrep, jev-semgrep ou ripgrep separadamente.

```sh
pi install git:github.com/rodrigojager/pi-workspace-search@v0.1.0
```

Em uma sessão já aberta, execute `/reload`. Então use `/search-setup`:

1. **Configure Jev API key** prepara o comando nativo `/login typesafe` no editor. Pressione Enter e informe a chave no diálogo do Pi. A extensão não recebe nem armazena a chave; o login nativo do Pi administra as credenciais. Também aceita `TYPESAFE_API_KEY` no ambiente para uso sem interface.
2. **Enable Jev for this workspace** habilita o envio de trechos desse projeto para TypeSafe. A autorização é por caminho canônico de projeto e fica fora do repositório.
3. Opcionalmente escolha **Install optional zvec-grep**. As dependências são instaladas em `~/.pi/agent/workspace-search/runtime`, sem instalação global. Se já houver zvec no PATH, ele é reaproveitado. O suporte nativo do zvec depende da plataforma; falhas deixam o fluxo seguir com Jev.
4. Use `/search-test` para uma chamada real com código sintético, sem arquivos do projeto. `/search-status` mostra autenticação, backends e limites.

Para zvec, `/search-index` cria explicitamente um novo índice com `local/potion-code-16m-v2`. Pode baixar o modelo local. Nenhuma busca cria, atualiza, reconstrói ou apaga um índice. Índices que usam embeddings remotos são recusados. Gerencie a atualização de índices existentes explicitamente pelo seu zvec; esta versão apenas os consulta e lê a fonte atual.

## Uso

O agente recebe `workspace_search`, `workspace_expand` e uma skill curta de roteamento. As ferramentas nativas do Pi continuam disponíveis. A extensão orienta a preferência por buscas limitadas, mas não bloqueia `read` ou `bash`.

```json
{"query":"fetchWithRetry","mode":"exact","scope":"src"}
{"query":"onde requisições HTTP são repetidas após falha","mode":"semantic","scope":"src"}
{"query":"retry after network failures","mode":"semantic","backend":"jev","scope":"src/network"}
```

`backend="auto"` é o padrão. `backend="jev"` permite tentar Jev quando o ranking local retornou candidatos que não responderam à pergunta. `backend="zvec"` consulta só o índice local. Quando Jev atingir o limite de varredura, prefira restringir `scope`; também pode continuar com `offset=nextOffset` mantendo consulta e escopo. Cada página tem seu próprio orçamento. A ordem de arquivos é estável, mas mudanças no projeto podem alterar offsets.

`workspace_expand` recebe `file`, `startLine` e `endLine` e lê até 200 linhas atuais, com o mesmo limite de saída. Somente expanda o detalhe que falta para responder.

Sem chamar um modelo generativo:

```text
/search --exact fetchWithRetry
/search --regex fetch.*Retry
/search onde erros de rede são tratados
/search-status
/search-settings
```

## Limites e evidências

Padrão por busca Jev: até **60 trechos**, **120.000 caracteres de entrada contabilizados**, 3 chamadas simultâneas, timeout de 30 segundos por chamada e nenhuma repetição automática. Cada trecho tem no máximo 3.500 caracteres, com janelas de até 50 linhas e sobreposição. Não há um pré-filtro lexical obrigatório que elimine conceitos expressos com outras palavras.

Saída: até **7 resultados** e **8.000 caracteres de JSON**, incluindo metadados. Não é uma contagem exata de tokens. `stats.inputChars` inclui uma reserva para a pergunta de classificação, não mede a serialização interna exata do provedor. O número de chamadas é limitado; preços e contabilização de tokens pertencem ao serviço TypeSafe.

Resultados incluem arquivo, linhas, fonte original, score quando houver, `freshness`, `coverage`, `partial`, `outputTruncated`, erros e estatísticas. Scores são probabilidades/ranking de relevância, não prova da interpretação. O ranking zvec pode refletir um índice antigo mesmo quando o trecho retornado foi lido do arquivo atual. Itens que o zvec sinaliza como possivelmente antigos são descartados antes do fallback.

Buscas semânticas são amostras ranqueadas. Buscas exatas também são limitadas (até 30 correspondências por arquivo e saída limitada); um resultado vazio não prova ausência em arquivos ignorados, excluídos ou fora do escopo. Para enumerar todas as ocorrências, use `rg` com escopo e regras explícitos.

O cache local guarda **apenas probabilidades e datas**, sem consultas ou trechos em texto. A chave inclui hash da consulta, modelo, versão do critério, caminho e conteúdo atual. Mudanças na fonte invalidam a entrada. O alias `jev-latest` pode mudar; por isso o cache expira em 4 horas. Defina `cacheHours: 0` para desativá-lo.

## Configuração e dados

Configuração em `~/.pi/agent/workspace-search/settings.json`; respeita `PI_CODING_AGENT_DIR` via diretório nativo do Pi. `/search-settings` altera os principais limites. Também pode editar o arquivo fora da conversa com o modelo:

```json
{
  "remoteRoots": [],
  "model": "jev-latest",
  "threshold": 0.72,
  "maxChunks": 60,
  "maxInputChars": 120000,
  "maxOutputChars": 8000,
  "maxHits": 7,
  "concurrency": 3,
  "timeoutMs": 30000,
  "cacheHours": 4
}
```

Jev fica desabilitado em projetos novos até a configuração autorizar o envio. Descoberta respeita ignore rules, não segue symlinks para fora do projeto e exclui caminhos de credenciais, `.env`, chaves, dependências, arquivos de lock e diretórios gerados comuns. Arquivos ocultos não são descobertos por padrão. O filtro é de caminhos e não detecta todos os segredos incorporados em código. Arquivos binários e maiores que 200KB são pulados na varredura Jev e tornam a cobertura parcial. Expansão lê arquivos de até 500KB. Não configure projetos cujo conteúdo não possa ser enviado ao serviço.

## Desenvolvimento e validação

```sh
npm install --omit=peer
npm test
npm run check
node tools/verify-pi.mjs /path/to/node_modules/@earendil-works/pi-coding-agent
node tools/typecheck.mjs /path/to/node_modules/@earendil-works/pi-coding-agent
```

Os testes verificam roteamento, cache/invalidação, limites, erros, opt-in, caminhos e leitura. O teste do SDK carrega a extensão e skill no Pi instalado e executa busca/expansão reais, com sessão isolada e sem inferência de rede. Testes unitários usam um classificador injetado; isso não comprova a qualidade do Jev real. Para verificar acesso real, use `/search-test` com sua chave.

Referências de inspiração: [jev-semgrep](https://github.com/uehaj/jev-semgrep) e [sgrep](https://github.com/Lagnajit09/sgrep). A implementação usa a API pública nativa do Pi, sem copiar esses CLIs.
