Patches do Pumpkin usados pelo YacaCode (binário em minecraft/data/.bin/pumpkin).
Base: Pumpkin-MC/Pumpkin @ d0c0a5d73d3757258f7afb2ca240279d52653862

- pumpkin-yacacode.patch: esqueletos/stray/bogged/parched com arco e wither skeleton com espada no
  spawn natural + login com senha (yaca_auth.rs, /register /login /changepassword, senhas em
  minecraft/data/yacacode-auth.json; apagar a entrada de um nick libera novo /register).
  (pumpkin-skeleton-bow.patch é só a parte dos esqueletos.)

Build ARM64: git apply pumpkin-yacacode.patch && cargo build --release --target aarch64-unknown-linux-gnu
