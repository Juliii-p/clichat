'use strict';
// Scripts de autocompletado para la terminal: `clichat completion bash|zsh|powershell`.
// Completan subcomandos, opciones y, después de `join` o `forget`, los servidores
// recientes (los pide a `clichat __recientes`).

const SUBCOMMANDS = ['join', 'host', 'server', 'forget', 'completion', 'help'];
const OPTIONS = [
  '--nick', '--port', '--password', '--tls', '--no-tls', '--fp', '--e2e',
  '--log', '--bind', '--cert', '--key', '--simple', '--help', '--version',
];
const SHELLS = ['bash', 'zsh', 'powershell'];

function bash() {
  return `# Autocompletado de clichat para bash. Instalar con:
#   echo 'eval "$(clichat completion bash)"' >> ~/.bashrc
_clichat() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
    join|forget) COMPREPLY=( $(compgen -W "$(clichat __recientes 2>/dev/null)" -- "$cur") ); return ;;
    completion)  COMPREPLY=( $(compgen -W "${SHELLS.join(' ')}" -- "$cur") ); return ;;
    --log|--cert|--key) COMPREPLY=( $(compgen -f -- "$cur") ); return ;;
  esac
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${SUBCOMMANDS.join(' ')} ${OPTIONS.join(' ')}" -- "$cur") )
  else
    COMPREPLY=( $(compgen -W "${OPTIONS.join(' ')}" -- "$cur") )
  fi
}
complete -F _clichat clichat cli-chat
`;
}

function zsh() {
  return `# Autocompletado de clichat para zsh. Instalar con:
#   echo 'eval "$(clichat completion zsh)"' >> ~/.zshrc
autoload -U +X bashcompinit && bashcompinit
${bash().split('\n').slice(2).join('\n')}`;
}

function powershell() {
  return `# Autocompletado de clichat para PowerShell. Instalar con:
#   clichat completion powershell | Out-String | Add-Content $PROFILE
Register-ArgumentCompleter -Native -CommandName clichat, cli-chat -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })
  $index = if ($wordToComplete) { $words.Count - 1 } else { $words.Count }
  $prev = if ($index -ge 1) { $words[$index - 1] } else { '' }
  $subs = @(${SUBCOMMANDS.map((s) => `'${s}'`).join(', ')})
  $opts = @(${OPTIONS.map((s) => `'${s}'`).join(', ')})
  $candidates = switch -Regex ($prev) {
    '^(join|forget)$' { @(clichat __recientes 2>$null); break }
    '^completion$'    { @(${SHELLS.map((s) => `'${s}'`).join(', ')}); break }
    default           { if ($index -eq 1) { $subs + $opts } else { $opts } }
  }
  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;
}

const SCRIPTS = { bash, zsh, powershell, pwsh: powershell };

module.exports = { SCRIPTS, SHELLS };
