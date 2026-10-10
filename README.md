# Vault

Aplicação web e Android para gerir e avaliar videojogos, banda desenhada, cartas, Funko Pop!, figuras e categorias pessoais.

## Executar

Não requer instalação. Abre `index.html` no navegador ou inicia um servidor local:

```bash
npx serve .
```

## Android

A aplicação está preparada como PWA e projeto Capacitor. Depois de instalar Java 17 e Android Studio/SDK:

```bash
npm install
npm run android:add
npm run android:sync
npm run android:open
```

Para gerar um APK de desenvolvimento por linha de comandos:

```bash
cd android
./gradlew assembleDebug
```

O APK será criado em `android/app/build/outputs/apk/debug/app-debug.apk`.

## Versão online e sincronização

O servidor inclui contas, autenticação JWT, API e uma base SQLite central. Para iniciar localmente:

```bash
cp .env.example .env
npm install
npm run build
npm run serve
```

A aplicação ficará disponível em `http://localhost:3000`. Na primeira entrada, cria uma conta; os jogos existentes são migrados automaticamente para a categoria Videojogos.

O endereço central está configurado como `https://vault-exe.com`. Depois de publicar o servidor, executa `npm run android:sync` para incorporar esse endereço na aplicação Android.

### Publicação com Docker

```bash
docker build -t vault .
docker run -p 3000:3000 -v vault-data:/app/data -e JWT_SECRET="uma-chave-longa" vault
```

O volume `/app/data` tem de ser persistente para conservar utilizadores e coleções entre reinícios.

Os dados são guardados no `localStorage` do navegador. A aplicação inclui dados de demonstração na primeira utilização.

## Funcionalidades

- Dashboard global com valor estimado, investimento e valorização
- Videojogos, banda desenhada, cartas, Funko Pop! e figuras
- Categorias personalizadas criadas pelo utilizador
- Série, marca/editora, referência, condição, quantidade, código e notas
- Pesquisa, filtros, wishlist e exportação integral em CSV
- Migração de dados e compatibilidade com a app Android v1
- Interface responsiva

## Próximos passos

- Ligações licenciadas a catálogos, capas e fontes de preços
- Scanner de código de barras e reconhecimento de capas/cartas
- Histórico de valor, alertas e importação de CSV
