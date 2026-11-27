# Plano F09 — Verificação integrada

Branch `feature/F09-verificacao-integrada`, a partir da `main` com F01–F08 integradas. Um commit por etapa:
`F09: ...`.

1. **Cliente HTTP do script** (cookie jar, formulários, JSON, leitura de marcadores HTML).
2. **Passos 2–11** (eventos, compra, gateway, esgotado, lotação/preço, painel, check-in, isolamento entre
   organizadores).
3. **Passos 12–16** (cancelamento com resposta tardia, rajadas, 401/422/404).
4. **`scripts/rajada.sh`**.
5. **Execução** contra a `main` integrada a partir de um clone limpo; correções de integração (se houver) com
   teste na feature dona.
6. **Documentação**: comandos no `AGENTS.md`/README.
