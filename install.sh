#!/usr/bin/env bash
# AgentOS user-local installer
# Recommended remote usage: curl -fsSL https://br3eze.africa/install.sh -o /tmp/agentos-install.sh && bash /tmp/agentos-install.sh
# Do not pipe untrusted content directly to a shell in production.
set -Eeuo pipefail

REPO_URL="${AGENTOS_REPO_URL:-https://github.com/br3eze-code/br3eze-code.git}"
REF="${AGENTOS_REF:-main}"
PROFILE="${AGENTOS_PROFILE:-default}"
HOME_DIR="${HOME:?HOME is required}"
PROFILE_DIR="${HOME_DIR}/.agentos"
[[ "$PROFILE" == "default" ]] || PROFILE_DIR="${HOME_DIR}/.agentos-${PROFILE}"
INSTALL_DIR="${AGENTOS_INSTALL_DIR:-${PROFILE_DIR}/app}"
BIN_DIR="${AGENTOS_BIN_DIR:-${HOME_DIR}/.local/bin}"
INSTALL_DIR_EXPLICIT=0
[[ -n "${AGENTOS_INSTALL_DIR:-}" ]] && INSTALL_DIR_EXPLICIT=1
DESKTOP_BUILD=0
FORCE=0

info() { printf '[AgentOS] %s\n' "$*"; }
warn() { printf '[AgentOS][warn] %s\n' "$*" >&2; }
fatal() { printf '[AgentOS][error] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --ref REF             Git branch or tag (default: main)
  --profile NAME        AgentOS profile (default: default)
  --install-dir DIR     Application directory
  --desktop             Build the Electron directory package after install
  --force               Allow replacing an existing non-AgentOS directory
  --help                Show this help

The installer is user-local by default. It does not require sudo, write API
keys to shell profiles, or enable a network service automatically.
EOF
}

while (($#)); do
  case "$1" in
    --ref) REF="${2:?--ref requires a value}"; shift 2 ;;
    --profile) PROFILE="${2:?--profile requires a value}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:?--install-dir requires a value}"; INSTALL_DIR_EXPLICIT=1; shift 2 ;;
    --desktop) DESKTOP_BUILD=1; shift ;;
    --force) FORCE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fatal "Unknown option: $1" ;;
  esac
done

[[ "$PROFILE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || fatal "Invalid profile name: $PROFILE"
PROFILE_DIR="${HOME_DIR}/.agentos"
[[ "$PROFILE" == "default" ]] || PROFILE_DIR="${HOME_DIR}/.agentos-${PROFILE}"
if [[ "$INSTALL_DIR_EXPLICIT" -eq 0 ]]; then INSTALL_DIR="${PROFILE_DIR}/app"; fi
INSTALL_DIR="$(cd "$(dirname "$INSTALL_DIR")" 2>/dev/null && pwd)/$(basename "$INSTALL_DIR")" || fatal "Invalid install directory"
BIN_DIR="$(mkdir -p "$BIN_DIR" && cd "$BIN_DIR" && pwd)" || fatal "Invalid bin directory"
[[ "$INSTALL_DIR" != "/" && "$INSTALL_DIR" != "$HOME_DIR" ]] || fatal "Refusing unsafe install directory: $INSTALL_DIR"

command -v node >/dev/null 2>&1 || fatal "Node.js 22 or newer is required. Install it from https://nodejs.org/ and rerun."
command -v npm >/dev/null 2>&1 || fatal "npm is required."
command -v git >/dev/null 2>&1 || fatal "git is required."
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 22) process.exit(1)' \
  || fatal "Node.js 22 or newer is required; found $(node --version)."

mkdir -p "$PROFILE_DIR" "$BIN_DIR"
chmod 0700 "$PROFILE_DIR" "$BIN_DIR"
if [[ -L "$INSTALL_DIR" ]]; then fatal "Refusing symlink install directory: $INSTALL_DIR"; fi
if [[ -e "$INSTALL_DIR/.git" ]]; then
  info "Updating existing AgentOS checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" checkout --force FETCH_HEAD
elif [[ -e "$INSTALL_DIR" && "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit)" && "$FORCE" -ne 1 ]]; then
  fatal "Install directory is not empty: $INSTALL_DIR (use --force only if it is disposable)"
else
  if [[ -e "$INSTALL_DIR" ]]; then rm -rf "$INSTALL_DIR"; fi
  info "Cloning AgentOS ref $REF"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
info "Installing production dependencies from the lockfile"
npm ci --omit=dev --ignore-scripts
node scripts/installer-init.mjs --profile "$PROFILE" --install-dir "$INSTALL_DIR" >/dev/null

WRAPPER="$BIN_DIR/agentos"
profile_literal=$(printf '%q' "$PROFILE")
entrypoint_literal=$(printf '%q' "$INSTALL_DIR/bin/agentos.js")
printf '#!/usr/bin/env bash\nset -Eeuo pipefail\nexport AGENTOS_PROFILE=%s\nexec %s "$@"\n' "$profile_literal" "$entrypoint_literal" > "$WRAPPER"
chmod 0755 "$WRAPPER"

RC_FILE="${SHELL_RC_FILE:-${HOME_DIR}/.bashrc}"
if [[ "${SHELL:-}" == *zsh* ]]; then RC_FILE="${SHELL_RC_FILE:-${HOME_DIR}/.zshrc}"; fi
MARKER="# AgentOS PATH"
if [[ "$RC_FILE" == *$'\n'* || "$RC_FILE" == *$'\r'* ]]; then fatal "Invalid shell rc path"; fi
if [[ -f "$RC_FILE" ]] && ! grep -Fq "$MARKER" "$RC_FILE"; then
  printf '\n%s\nexport PATH="%s:$PATH"\n' "$MARKER" "$BIN_DIR" >> "$RC_FILE"
elif [[ ! -f "$RC_FILE" ]]; then
  printf '%s\nexport PATH="%s:$PATH"\n' "$MARKER" "$BIN_DIR" > "$RC_FILE"
fi
export PATH="$BIN_DIR:$PATH"

if [[ "$DESKTOP_BUILD" -eq 1 ]]; then
  info "Building the Electron directory package"
  npm install --include=dev --ignore-scripts
  npm run desktop:pack
fi

info "Installed AgentOS at $INSTALL_DIR"
info "Profile: $PROFILE_DIR"
info "CLI: $WRAPPER"
info "Run: source $RC_FILE && agentos onboard"
info "Authenticate with: agentos login"
info "The installer did not write API keys or credentials to shell startup files."
