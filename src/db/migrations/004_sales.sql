-- F04: ingressos (um por compra). Nascem pendentes e já ocupam vaga (R05, R06); o handler do gateway confirma ou
-- recusa só enquanto pendente (R08, R11); F07 cancela/estorna; F06 grava checked_in_at (não é status).
CREATE TABLE tickets (
  id             text PRIMARY KEY,
  event_id       text NOT NULL REFERENCES events (id),
  code           text NOT NULL UNIQUE,              -- 8 caracteres, usado no check-in (R09)
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  channel        text NOT NULL CHECK (channel IN ('storefront', 'partner')),
  user_id        text REFERENCES users (id),        -- null nas compras pela API (R06/brief)
  buyer_email    text NOT NULL,
  price_cents    integer NOT NULL CHECK (price_cents > 0), -- preço vigente na compra (R03)
  checked_in_at  timestamptz,                       -- escrito por F06; "checkedIn" na API
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_user_idx ON tickets (user_id, created_at);
