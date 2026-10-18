# Roboin's dotfiles

To use the dotfiles, run the following command. Once you run `mise run sync` in the dotfiles directory, that command becomes available globally for future use.

```bash
# Clone the repository in your home directory
git clone https://github.com/Robot-Inventor/dotfiles.git

# Install all tools and sync dotfiles
cd dotfiles
mise bootstrap
```

## Otty

Before applying these settings to an existing installation:

1. Back up `~/.config/otty/config.toml` and `config.local.toml`, if present.
2. Run `otty config edit --local`. Copy every `profile = ...` line and the
   `default-profile = ...` line from the original config into this local file,
   preserving their order. Keep `~/.config/otty/profiles/` in place; neither it nor
   `config.local.toml` is managed by this repository.
3. Apply the Otty settings with `mise dot apply ~/.config/otty/config.toml`.
