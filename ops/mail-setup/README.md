# Proton Bridge + Thunderbird

1. Install `protonmail-bridge` (proton.me/mail/bridge), `thunderbird`, `pass`, `gnupg`.
2. `./01-bootstrap-pass.sh`
3. `protonmail-bridge --cli` -> `login` (2FA) -> `info` (copy the Bridge password) -> `exit`
4. `mkdir -p ~/.config/systemd/user && cp protonmail-bridge.service ~/.config/systemd/user/`
   `systemctl --user daemon-reload && systemctl --user enable --now protonmail-bridge`
   `loginctl enable-linger "$USER"`
5. In Bridge CLI/GUI export the TLS cert; import into Thunderbird (Settings > Privacy & Security > Certificates > Authorities), trust for email.
6. Fresh profile only: edit YOU@proton.me in `thunderbird-bridge.user.js`, copy to `<profile>/user.js`. Otherwise add the account manually using the same values.
7. First Thunderbird connect prompts for the Bridge password.
