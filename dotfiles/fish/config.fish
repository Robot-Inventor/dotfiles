fish_add_path --path "$HOME/.local/bin" "$HOME/bin"

set -gx EDITOR vi
set -gx VISUAL vi

if status is-interactive
    "$HOME/.local/bin/mise" activate fish | source

    # Address unnatural OpenCode colors in Otty.
    set -gx COLORTERM truecolor

    starship init fish | source
end
