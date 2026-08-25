# MYCFO

Aplicação financeira pessoal por ciclos, com autenticação sem senha e persistência segura no Supabase.

## Recursos

- Ciclo financeiro com dia inicial configurável.
- Receitas e despesas realizadas ou pendentes.
- Orçamento por categoria e cálculo do valor livre.
- Repetição de lançamento para o próximo ciclo.
- Importação idempotente do backup da versão local.
- Exportação de backup JSON.
- Row Level Security por usuário em todas as tabelas.
- Interface responsiva para desktop e celular.

## Desenvolvimento

Requisitos: Node.js 22 ou superior.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Preencha `.env.local` com a URL e a chave publicável do projeto Supabase. Nunca use uma chave secreta ou `service_role` no frontend.

## Verificação

```bash
npm run check
```

Esse comando executa os testes financeiros e a build de produção.

## Banco de dados

As migrations ficam em `supabase/migrations`. O schema inclui `profiles`, `categories`, `transactions` e `budgets`, além de índices, constraints, grants e políticas RLS.

## Produção

O workflow `deploy-pages.yml` publica a branch `main` no GitHub Pages. Configure no repositório os secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Depois dos secrets e redirects estarem validados, defina a variável de repositório `PRODUCTION_READY=true` para liberar o deploy.

No Supabase Auth, inclua a URL do GitHub Pages em **Site URL** e **Redirect URLs** antes de testar o login por link mágico.
