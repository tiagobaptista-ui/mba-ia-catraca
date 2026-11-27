# Fluxo do avaliador (cópia de referência do enunciado)

`$WEB` e `$API` são os endereços do produto e da API de parceiros (README: ambos `http://localhost:3000`) e `$KEY` é a
chave de parceiro (`pk_test_catraca_parceiro`). As contas do organizador A, do organizador B e do participante vêm da
seed. O passo-a-passo 2–16 está automatizado em `scripts/fluxo-avaliador.mjs` (F09) e o passo 15 em
`scripts/rajada.sh`.

1. Clone o repositório em uma pasta vazia e rode o comando de subida do README. O produto fica acessível em `$WEB`,
   com a seed carregada, sem nenhum outro passo.
2. Como organizador A, crie o evento E1 (lotação 2, R$ 100,00, data no mês seguinte) sem publicar. Deslogado, a
   vitrine não mostra E1, e a listagem da API também não:
   `curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"`
3. Ainda como A, tente criar um evento com a data de ontem: a criação é rejeitada.
4. Publique E1. Ele aparece na vitrine e na listagem da API com `availableSeats` 2 e `priceCents` 10000. Guarde o
   `id` em `$E1`.
5. Crie uma conta de participante nova pela interface e, com ela, compre E1 na vitrine com o cartão
   `4000000000000001`. Em "Meus ingressos" o ingresso aparece pendente e, em até 5 segundos (recarregando a página),
   confirmado. Anote o código como C1.
6. Compre E1 pela API com o cartão `4000000000000004`:
   `curl -s -X POST "$API/api/partner/events/$E1/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"t2@example.com","cardNumber":"4000000000000004"}'`
   A resposta é `202` com `pending`; guarde o `ticketId` em `$T2` e anote o `code` como C2. A listagem passa a
   mostrar E1 com `availableSeats` 0.
7. Antes de completar 30 segundos do passo 6, uma compra de E1 pela API com o cartão `4000000000000001` responde
   `409` com `sold_out`, e a vitrine exibe `Ingressos esgotados` para o participante do passo 5.
8. Passados 45 segundos do passo 6, `$T2` está `declined` e E1 volta a ter `availableSeats` 1:
   `curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$T2"`
   Compre E1 pela API com o cartão `4000000000000001` (T3). Em até 5 segundos, T3 está `confirmed`.
9. Como A, tente reduzir a lotação de E1 para 1: é rejeitado. Mude o preço para R$ 150,00 e a lotação para 3: é
   aceito. Compre E1 pela API com o cartão `4000000000000001` (T4) e espere a confirmação. O painel de E1 mostra
   Confirmados 3, Pendentes 0, Check-ins 0, Vagas disponíveis 0, Receita R$ 350,00 e Estornados 0.
10. No check-in de E1: C1 resulta em `Entrada liberada`; C1 de novo, em `Ingresso já utilizado`; C2, em
    `Ingresso não confirmado`; `ZZZZZZZZ`, em `Ingresso inválido para este evento`. O painel passa a mostrar
    Check-ins 1. Copie o endereço da página de gestão de E1.
11. Como organizador B, a lista de eventos da área de organizador não mostra E1, e abrir o endereço copiado não exibe
    nenhum dado de E1 (nome, números ou ingressos; o id no próprio endereço não conta). Ainda como B, crie e publique
    o evento E2 (lotação 1, R$ 20,00), pegue o `id` dele na listagem da API e compre-o pela API com o cartão
    `4000000000000001`, anotando o código como C3. Como o participante da seed, e depois deslogado, o endereço
    copiado também não exibe dados de E1. De volta como A, C3 no check-in de E1 resulta em
    `Ingresso inválido para este evento`.
12. Como A, crie e publique o evento E3 (lotação 5, R$ 50,00), guarde o `id` em `$E3`, deixe a página de gestão de
    E3 aberta e compre-o pela API com o cartão `4000000000000003` (`$T5`) e, logo depois, com o cartão
    `4000000000000001` (`$T6`, código C6). Espere T6 ficar `confirmed` e, antes de completar 30 segundos da compra de
    T5, cancele E3.
13. E3 sai da vitrine e da listagem da API, e uma compra de E3 pela API responde `404` com `event_not_available`.
    Em até 10 segundos, T6 está `refunded` e T5 está `cancelled`. A página de gestão de E3 não permite editar o
    evento.
14. Passados 45 segundos da compra de T5, T5 continua `cancelled`. No check-in de E3, C6 resulta em
    `Evento cancelado` (ou a mensagem aparece no lugar do campo). O painel de E3 mostra Confirmados 0, Pendentes 0,
    Check-ins 0, Vagas disponíveis 0, Receita R$ 0,00 e Estornados 1.
15. Como A, crie e publique o evento E4 (lotação 5, R$ 10,00), guarde o `id` em `$E4` e dispare 30 compras
    simultâneas:
    ```
    seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
      -X POST "$API/api/partner/events/$E4/purchases" \
      -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
      -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
    ```
    A saída mostra exatamente 5 respostas `202` e 25 `409`. Em até 10 segundos, o painel de E4 mostra Confirmados 5
    e Vagas disponíveis 0. Repita com um evento novo, E5, com o mesmo resultado.
16. Nas três rotas da API, sem o cabeçalho e com uma chave errada, a resposta é `401` com `unauthorized`. Uma compra
    com `"cardNumber":"123"` responde `422` com `invalid_request`, e a consulta de um `ticketId` inexistente responde
    `404` com `ticket_not_found`.
17. Rode o comando de gates: passa. Rode o de derrubar: nenhuma porta que a subida abriu responde, e nenhum container
    do projeto continua rodando (`docker ps`). Suba de novo: sobe sem erro, e as credenciais da seed continuam
    funcionando.
18. Pelo mapa do README, confira o PRD, a spec, o plano e o contrato de cada feature, os relatórios, o arquivo de
    estado, o `AGENTS.md` e os PRs da wave paralela. Um relatório que nunca foi alterado aparece em um único commit:
    `git log --format="%h %ad" --date=iso -- caminho/do/relatorio.md`
