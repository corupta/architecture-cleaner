# Shared look of every CLI shot: 1920×1080 at 30 fps, a large font, no window chrome. Each tape `Source`s this file.
Set Shell "bash"
Set FontFamily "DejaVu Sans Mono"
Set FontSize 24
Set LineHeight 1.25
Set Width 1920
Set Height 1080
Set Padding 48
Set Framerate 30
Set TypingSpeed 35ms
Set Theme { "name": "ac", "black": "#262624", "red": "#d03b3b", "green": "#0ca30c", "yellow": "#fab219", "blue": "#3987e5", "magenta": "#b05fd0", "cyan": "#199e70", "white": "#e8e6df", "brightBlack": "#8a887f", "brightRed": "#ec835a", "brightGreen": "#3fc63f", "brightYellow": "#ffd166", "brightBlue": "#6aa8f0", "brightMagenta": "#c98be0", "brightCyan": "#4fd1a5", "brightWhite": "#ffffff", "background": "#1b1b1a", "foreground": "#e8e6df", "cursor": "#e8e6df", "selection": "#3a3a37" }
# `Wait` returns when the last line is the bare prompt, i.e. when the command has finished.
Set WaitPattern /^\$\s*$/
