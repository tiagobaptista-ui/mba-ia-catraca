-- F03: gateway de pagamento simulado. Cada cobrança guarda o resultado e o instante sorteados na compra;
-- o worker do módulo gateway entrega as respostas vencidas (responded_at IS NULL AND respond_at <= now()).
CREATE TABLE gateway_charges (
  id            text PRIMARY KEY,
  ticket_id     text NOT NULL,          -- sem FK: a tabela tickets é de F04 (wave 3)
  card_last4    text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'), -- nunca guardamos o número completo
  amount_cents  integer NOT NULL CHECK (amount_cents > 0),
  outcome       text NOT NULL CHECK (outcome IN ('approved', 'declined')),
  respond_at    timestamptz NOT NULL,
  responded_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0, -- entregas que falharam (handler lançou erro)
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gateway_charges_due_idx ON gateway_charges (respond_at) WHERE responded_at IS NULL;
CREATE INDEX gateway_charges_ticket_idx ON gateway_charges (ticket_id);
