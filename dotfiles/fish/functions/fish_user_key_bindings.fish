function fish_user_key_bindings
    # A separate mode lets typing replace the selection, including spaces and operators.
    bind -m select_all ctrl-a beginning-of-buffer begin-selection end-of-buffer
    bind -M select_all -m default '' kill-selection end-selection self-insert

    bind -M select_all ctrl-a beginning-of-buffer begin-selection end-of-buffer
    bind -M select_all -m default backspace kill-selection end-selection
    bind -M select_all -m default delete kill-selection end-selection
    bind -M select_all -m default escape end-selection
    bind -M select_all -m default enter end-selection execute
    bind -M select_all -m default ctrl-c end-selection cancel-commandline

    bind -M select_all -m default left end-selection backward-char
    bind -M select_all -m default right end-selection forward-char
    bind -M select_all -m default up end-selection up-or-search
    bind -M select_all -m default down end-selection down-or-search
    bind -M select_all -m default home end-selection beginning-of-line
    bind -M select_all -m default end end-selection end-of-line
end
