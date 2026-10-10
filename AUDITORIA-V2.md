# VAULT.EXE — Auditoria funcional, técnica e de mercado

Data: 10 de outubro de 2026
Âmbito: aplicação web, API Node/Express, SQLite, PWA e projeto Android/Capacitor.

## Resumo executivo

A versão anterior era um MVP funcional para videojogos, mas o modelo de dados estava limitado a uma tabela `games`, a wishlist era apenas visual e a sincronização não conseguia representar outras coleções. A versão 2 introduz um modelo genérico de categorias e itens, migração automática dos jogos existentes e uma API legada para manter os APK v1 operacionais durante a transição.

Foram ainda corrigidos riscos relevantes de validação, brute force, CORS, cabeçalhos de segurança, conflitos de sincronização e cache da PWA. Os testes automatizados cobrem autenticação, categorias, itens e compatibilidade Android v1.

## Pesquisa de mercado

### Padrões validados

- **Catálogo multiformato e categorias pessoais.** iCollect Everything suporta mais de 40 tipos, coleções personalizadas, cloud sync, wishlist, valores, filtros e edição em massa. Fonte: https://www.icollecteverything.com/support/
- **BD exige dados especializados.** CLZ Comics dá prioridade a série, número, variante, editora, criadores, grade, grading company, assinatura, caixa/localização, preço e data de compra. Fonte: https://clz.com/comics/mobile
- **Cartas são tratadas como portefólio.** Collectr destaca jogo, set, número, variante, grade, custo, valor atual, evolução e digitalização da carta. Fonte: https://www.getcollectr.com/
- **Pops e figuras precisam de variantes e referência.** hobbyDB/Pop Price Guide assenta em marca, série/linha, referência, barcode, variante e histórico de valor. Fonte: https://blog.hobbydb.com/2025/03/24/pop-price-guide-now-fully-integrated/
- **Preço e condição são inseparáveis.** PriceCharting e RetroCap distinguem estado/completude, histórico e comparáveis; isto recomenda guardar sempre a origem e data de qualquer avaliação automática futura. Fontes: https://www.pricecharting.com/page/collection-tracker e https://retrocap.app/

### Funcionalidades implementadas nesta versão

- Categorias incluídas: Videojogos, Banda desenhada, Cartas, Funko Pop! e Figuras.
- Categorias pessoais ilimitadas, com nome, ícone e cor.
- Campos comuns flexíveis: título, série, marca/editora, número/referência, plataforma, condição, completude/formato, região/idioma, quantidade, barcode, preço pago, valor atual, imagem e notas.
- Estados `owned`, `wishlist` e `sold`.
- Dashboard agregado, distribuição por categoria, destaques, pesquisa transversal e filtros.
- Exportação CSV de todo o arquivo.
- Sincronização cloud e uso offline.

### Roadmap recomendado

1. Importação CSV assistida e backup JSON completo.
2. Histórico de avaliações, fonte do preço, moeda e data da avaliação.
3. Scanner EAN/UPC e pesquisa em catálogos licenciados.
4. Upload de fotografias próprias, frente/verso e armazenamento otimizado.
5. Campos personalizados por categoria e vistas configuráveis.
6. Partilha pública opcional, inventário para seguro e relatório PDF.
7. Alertas de preço e lançamento, marketplace apenas numa fase posterior.

## Auditoria técnica e correções

### SEC-01 — Validação insuficiente na API

- Severidade original: Alta
- Localização: `server/index.js`, normalização de itens e rotas de escrita.
- Evidência anterior: o corpo era convertido diretamente com `String`/`Number`, sem limites consistentes.
- Impacto: payloads excessivos, valores inválidos e dados inconsistentes.
- Correção: limites de texto, números finitos e positivos, quantidade limitada, estados allowlist, datas normalizadas, limite de body e limite de 5.000 registos por sincronização.
- Estado: Corrigido.

### SEC-02 — Ausência de proteção contra brute force

- Severidade original: Média
- Localização: `server/index.js`, `/api/auth/register` e `/api/auth/login`.
- Impacto: tentativas de credenciais sem limitação ao nível da aplicação.
- Correção: limitação por IP/janela nas rotas de autenticação. Recomenda-se complementar com rate limiting no proxy/CDN em produção.
- Estado: Corrigido na aplicação; validar também no alojamento.

### SEC-03 — Cabeçalhos de segurança incompletos

- Severidade original: Média
- Localização: bootstrap Express.
- Impacto: menor proteção contra framing, MIME sniffing e fuga de referrer.
- Correção: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy`; `X-Powered-By` continua desativado.
- Estado: Corrigido. CSP estrita fica para uma iteração que remova scripts inline e dependência de fontes Google.

### SEC-04 — Política CORS permissiva quando mal configurada

- Severidade original: Média
- Localização: middleware CORS.
- Impacto: uma configuração ausente aceitava qualquer origem.
- Correção: allowlist explícita quando `ALLOWED_ORIGINS` está definida, mantendo chamadas sem `Origin` para clientes nativos.
- Estado: Corrigido; produção deve definir `ALLOWED_ORIGINS`.

### SEC-05 — Token persistente em localStorage

- Severidade: Média
- Impacto: uma vulnerabilidade XSS poderia expor o JWT.
- Mitigação atual: saída HTML escapada, imagens limitadas a HTTP(S), sem execução dinâmica, cabeçalhos defensivos.
- Recomendação: avaliar cookies HttpOnly no site e armazenamento seguro nativo no Android numa versão maior, pois a mudança afeta autenticação cross-origin e migração de sessões.
- Estado: Risco conhecido, não alterado nesta versão para preservar a app instalada.

### DATA-01 — Modelo preso a videojogos

- Severidade funcional: Alta
- Correção: tabelas `categories` e `items`, constraints, índices por utilizador/categoria/estado/data e metadata preparada para extensões.
- Estado: Corrigido.

### DATA-02 — Risco de perda dos jogos existentes

- Severidade funcional: Alta
- Correção: migração idempotente de `games` para `items`; a tabela e endpoints antigos foram preservados e os jogos são espelhados nos dois modelos.
- Estado: Corrigido.

### SYNC-01 — Conflitos e categorias locais incompatíveis

- Severidade funcional: Alta
- Impacto: o primeiro sync podia falhar porque os IDs offline não existiam no servidor; uma versão antiga podia sobrescrever dados mais recentes.
- Correção: categorias são emparelhadas por `systemKey`/nome antes do sync, categorias pessoais offline são criadas no servidor e a escrita respeita `updatedAt` para evitar substituir uma versão mais recente.
- Estado: Corrigido.

### UX-01 — Wishlist não funcional

- Severidade funcional: Média
- Correção: wishlist é agora um estado real do item, com vista, criação e edição.
- Estado: Corrigido.

### OPS-01 — Cache PWA podia manter JavaScript antigo

- Severidade operacional: Média
- Correção: nova versão de cache e versionamento do URL de `app.js`.
- Estado: Corrigido.

### QA-01 — Ausência de testes automatizados

- Severidade operacional: Média
- Correção: testes Node para health, registo, categorias predefinidas, categorias pessoais, itens multi-coleção e espelhamento da API Android v1.
- Estado: Corrigido para os fluxos críticos; ampliar cobertura progressivamente.

## Verificações executadas

- `node --check server/index.js`
- `node --check app.js`
- `npm test`: 4/4 testes aprovados
- `npm run build`: aprovado
- Browser desktop: landing, entrada offline, coleção, gestor de categorias, criação de categoria e criação de carta
- Browser tablet 800×1280: coleção e cartões responsivos
- Inspeção de consola após correção do erro de inicialização

## Limitações conhecidas

- Valores são manuais; preços automáticos precisam de acordos/API, regras por região e indicação da fonte/data.
- Imagens usam URL; upload próprio necessita de storage persistente (S3/R2 ou equivalente) e redimensionamento.
- A base SQLite é adequada para o piloto/servidor único; escalar horizontalmente exigirá PostgreSQL ou arquitetura equivalente.
- O APK deve ser recompilado e distribuído depois de cada alteração do bundle web nativo.
