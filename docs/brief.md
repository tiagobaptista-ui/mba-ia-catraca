# Brief da fundadora (cópia de referência)

> Texto-fonte das regras R01–R13, do contrato fixo da API de parceiros e do gateway simulado. O PRD
> (`docs/PRD.md`) rastreia cada regra até os critérios de aceite.

A Catraca vende ingressos para eventos pequenos: shows em bar, workshops, meetups.

## Quem usa

- **Visitante**: sem login, vê a vitrine de eventos.
- **Participante**: cria a própria conta (nome, e-mail e senha), entra, sai, compra ingressos e vê os próprios ingressos.
- **Organizador**: não se cadastra pelo produto; as contas de organizador vêm da seed. Cria e opera os próprios eventos.
- **Parceiro**: sistema externo que vende ingressos pela API de parceiros, autenticado por uma chave.

## Status do ingresso

Na interface aparece o rótulo; na API, o valor.

| Rótulo | Valor na API | Quando |
|---|---|---|
| pendente | `pending` | compra criada, aguardando a resposta do gateway |
| confirmado | `confirmed` | o gateway aprovou |
| recusado | `declined` | o gateway recusou |
| cancelado | `cancelled` | estava pendente quando o evento foi cancelado |
| estornado | `refunded` | estava confirmado quando o evento foi cancelado |

Ter passado pelo check-in não é um status: é uma informação à parte (na API, o campo `checkedIn`).

## Regras

### Eventos

- **R01.** Um evento tem nome, data e hora de início, local, lotação (inteiro, mínimo 1) e preço (em reais, maior que zero). A data de início precisa estar no futuro, ao criar e ao editar.
- **R02.** Todo evento nasce como rascunho. Só evento publicado e não cancelado aparece na vitrine e na listagem da API de parceiros e aceita compras.
- **R03.** A lotação nunca pode ficar menor que as vagas ocupadas (R05). Mudança de preço vale só para as compras feitas depois dela.
- **R04.** Cada evento tem uma página de gestão com endereço (URL) próprio, onde o organizador edita, publica, cancela, faz o check-in e vê o painel.

### Vagas e compra

- **R05.** Vagas ocupadas são os ingressos pendentes mais os confirmados. Vagas disponíveis são a lotação menos as vagas ocupadas; em evento cancelado, são zero.
- **R06.** Cada compra é de um ingresso, feita pelo participante na vitrine ou pelo parceiro na API. A compra nasce pendente, já ocupa vaga e é respondida sem esperar o gateway.
- **R07.** Sem vaga disponível, a compra é recusada: a vitrine exibe `Ingressos esgotados` (no lugar da compra ou como resposta à tentativa) e a API responde `sold_out`. As vagas ocupadas nunca passam da lotação, nem com compras simultâneas.
- **R08.** Quando o gateway aprova, o ingresso fica confirmado. Quando recusa, fica recusado e a vaga é liberada.
- **R09.** Cada ingresso tem um código único, usado no check-in. Em "Meus ingressos", o participante vê o evento, o status e o código de cada ingresso que comprou.

### Check-in

- **R10.** Na página de gestão do evento, o organizador informa o código de um ingresso. A primeira situação verdadeira da lista abaixo, seguindo a ordem, define a mensagem exibida. Em evento cancelado, a mensagem `Evento cancelado` pode aparecer no lugar do campo de check-in; se o campo continuar disponível, vale a lista.
  1. O código não existe ou é de outro evento: `Ingresso inválido para este evento`
  2. O evento está cancelado: `Evento cancelado`
  3. O ingresso não está confirmado: `Ingresso não confirmado`
  4. O ingresso já passou pelo check-in: `Ingresso já utilizado`
  5. Nenhuma das anteriores: `Entrada liberada`

### Cancelamento

- **R11.** O organizador pode cancelar um evento publicado, e o cancelamento é irreversível: o evento sai da vitrine e da API, não vende mais e não pode ser editado nem republicado. Em até 10 segundos, os ingressos confirmados passam a estornados e os pendentes a cancelados. Resposta do gateway que chegue depois não muda o status de nenhum deles.

### Painel

- **R12.** A página de gestão mostra o painel do evento, contando as vendas da vitrine e da API com as definições abaixo.
  - Confirmados: ingressos confirmados, inclusive os que já passaram pelo check-in
  - Pendentes: ingressos pendentes
  - Check-ins: ingressos confirmados que já passaram pelo check-in
  - Vagas disponíveis: conforme R05
  - Receita: soma do valor pago pelos ingressos confirmados, com o preço vigente no momento de cada compra
  - Estornados: ingressos estornados

### Acesso

- **R13.** Na área de organizador, cada organizador só vê e opera os próprios eventos, inclusive quando acessa diretamente o endereço da página de gestão de um evento de outro organizador. Participante e visitante não acessam a área de organizador.

## Gateway de pagamento simulado

No modo padrão do produto, o gateway é simulado e responde conforme o final do número do cartão:

| Final | Resposta | Tempo |
|---|---|---|
| `0001` | aprovado | 2 a 5 s |
| `0002` | recusado | 2 a 5 s |
| `0003` | aprovado | 30 a 40 s |
| `0004` | recusado | 30 a 40 s |
| qualquer outro | recusado | 2 a 5 s |

O número do cartão tem 16 dígitos (ex.: `4000000000000001`); fora disso, a compra é rejeitada antes de criar o ingresso.

## API de parceiros (contrato fixo)

Toda rota exige o cabeçalho `X-Api-Key`; sem ele, ou com chave inválida: `401` `{"error":"unauthorized"}`. IDs são strings.

```
GET /api/partner/events
200
[ { "id": "evt_8f2k", "name": "Jazz no Porão", "startsAt": "2026-12-05T21:00:00-03:00", "priceCents": 10000, "availableSeats": 2 } ]
```

```
POST /api/partner/events/{eventId}/purchases
Content-Type: application/json
{ "buyerEmail": "ana@example.com", "cardNumber": "4000000000000001" }
202
{ "ticketId": "tkt_51xq", "code": "K7Q2M9XA", "status": "pending" }
```

Ordem dos erros (depois da chave): corpo inválido (campo faltando, e-mail mal formado ou cartão sem 16 dígitos) →
`422` `{"error":"invalid_request"}`; evento inexistente, em rascunho ou cancelado → `404`
`{"error":"event_not_available"}`; falta de vaga → `409` `{"error":"sold_out"}`.

```
GET /api/partner/tickets/{ticketId}
200
{ "ticketId": "tkt_51xq", "code": "K7Q2M9XA", "eventId": "evt_8f2k", "status": "confirmed", "checkedIn": false }
```

Ingresso inexistente → `404` `{"error":"ticket_not_found"}`. Compras pela API não ficam vinculadas a contas de
participante, mas valem para lotação, painel, check-in e cancelamento exatamente como as da vitrine.

## Fora de escopo (do brief)

Deploy; gateway real, e-mail e notificações; app mobile e qualidade visual; cadastro de organizador pelo produto;
mais de um ingresso por compra, mapa de assentos, cancelamento ou transferência de ingresso pelo participante;
atualização em tempo real; fuso horário (o fluxo usa datas com pelo menos um dia de folga).
