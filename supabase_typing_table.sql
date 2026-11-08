 git add src/typing.js src/health.js index.js supabase_typing_table.sql-- Execute isso no SQL Editor do Supabase pra criar a tabela de persistência do /digitando
-- Isso permite que o bot lembre quais canais estavam com "digitando on" após restart

create table if not exists bot_typing_state (
  channel_id       bigint primary key,
  guild_id         bigint not null,
  active           boolean not null default true,
  started_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Índice pra buscar ativos rápido
create index if not exists idx_bot_typing_state_active on bot_typing_state (active) where active = true;

-- RLS (opcional, se quiser proteger)
alter table bot_typing_state enable row level security;

-- Política: só service role pode mexer (o bot usa service key)
create policy "Service role full access" on bot_typing_state
  for all using (auth.role() = 'service_role');