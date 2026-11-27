-- F02: eventos do organizador (ciclo de vida draft → published → cancelled; F07 faz a última transição)
CREATE TABLE events (
  id            text PRIMARY KEY,
  organizer_id  text NOT NULL REFERENCES users (id),
  name          text NOT NULL,
  starts_at     timestamptz NOT NULL,
  venue         text NOT NULL,
  capacity      integer NOT NULL CHECK (capacity >= 1),
  price_cents   integer NOT NULL CHECK (price_cents > 0),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  published_at  timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_organizer_idx ON events (organizer_id, starts_at);
CREATE INDEX events_status_idx ON events (status, starts_at);
