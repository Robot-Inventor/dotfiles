# Roboin's dotfiles

To use the dotfiles, run the following command. Once you run `mise run sync` in the dotfiles directory, that command becomes available globally for future use.

```bash
# Clone the repository in your home directory
git clone https://github.com/Robot-Inventor/dotfiles.git

# Install all tools and sync dotfiles
cd dotfiles
mise bootstrap
```

## WSL shell

After bootstrapping, set fish as your login shell explicitly:

```bash
# Confirm that the installed shell is registered, then change the login shell
grep -Fx /usr/bin/fish /etc/shells
chsh -s /usr/bin/fish
```

Open a new WSL terminal to use fish. To switch back, run `chsh -s /bin/bash`.

## Environment variables

`mise run sync-env` writes `DO_NOT_TRACK=1` into the OS itself: the user registry plus
`WSLENV` on Windows, `/etc/environment` on Linux (sudo is required), and a `launchctl`
LaunchAgent on macOS. WSL terminals take the value from the Windows side through
`WSLENV`, so the Windows bootstrap has to run too. Programs that are already running keep
their old environment: restart the terminal application itself, and on Linux start a new
login session.

## Otty

Before applying these settings to an existing installation:

1. Back up `~/.config/otty/config.toml` and `config.local.toml`, if present.
2. Run `otty config edit --local`. Copy every `profile = ...` line and the
   `default-profile = ...` line from the original config into this local file,
   preserving their order. Keep `~/.config/otty/profiles/` in place; neither it nor
   `config.local.toml` is managed by this repository.
3. Apply the Otty settings with `mise dot apply ~/.config/otty/config.toml`.

## Zen + Sine mods

- `mise run sync-zen` wires `dotfiles/zen/mods.json` and `dotfiles/zen/user.js`
  as symlinks into the profile and installs any missing mod folder from its
  GitHub repository.
- `mise run sync-zen export` rewrites `dotfiles/zen/user.js` from the current
  `prefs.js`. Run it manually after changing mod settings.

## MozKey

MozKey settings live in `dotfiles/mozkey/config.json`.

- `mise run sync-mozkey` writes `config.json` into
  `%USERPROFILE%\AppData\LocalLow\Mozc\config1.db`.
- `mise run mozkey-export` regenerates `config.json` from the live file. Run it
  after changing settings in the MozKey dialog, review the diff, and commit it.
- `mise run mozkey-update-proto` refreshes the vendored `config.proto` from the
  latest MozKey release. Pass a tag to pin it, for example
  `mise run mozkey-update-proto v1.1.0`.

After updating MozKey, run `mise run mozkey-update-proto` and then
`mise run mozkey-export` before the next apply so settings added by the update are captured.
