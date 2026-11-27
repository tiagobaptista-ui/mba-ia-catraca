// Configuração lida do ambiente. Todos os valores têm padrão seguro para o modo local:
// nenhuma chave de pagamento real existe no produto (o gateway é sempre o simulado).

function number(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Variável ${name} inválida: ${raw}`);
  return value;
}

export const config = {
  port: number('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca',
  partnerApiKey: process.env.PARTNER_API_KEY || 'pk_test_catraca_parceiro',
  gatewayMode: process.env.GATEWAY_MODE || 'simulated',
  gatewayTimeScale: number('GATEWAY_TIME_SCALE', 1),
  gatewayPollMs: number('GATEWAY_POLL_MS', 200),
  sessionTtlHours: number('SESSION_TTL_HOURS', 12),
  logRequests: process.env.LOG_REQUESTS === '1',
};
