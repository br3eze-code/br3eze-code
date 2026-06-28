#!/bin/bash
# ============================================================
# AgentOS — One-Line Installer
# Usage: sudo bash install.sh
# ============================================================

set -euo pipefail

REPO_URL="https://github.com/br3eze-code/br3eze-code.git"
INSTALL_DIR="/opt/agentos"
SERVICE_USER="agentos"
NODE_MAJOR=22

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── OS & Platform Detection ───────────────────────────────────
OS_TYPE="linux"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS_TYPE="macos"
elif [ -f /etc/debian_version ]; then
    OS_TYPE="debian"
elif [ -f /etc/redhat-release ]; then
    OS_TYPE="rhel"
elif [ -f /etc/alpine-release ]; then
    OS_TYPE="alpine"
fi

# ── Root check (skipped on macOS) ──────────────────────────────
if [ "$OS_TYPE" != "macos" ] && [ "$EUID" -ne 0 ]; then
    error "Run as root: sudo bash install.sh"
fi

# ── Dependencies ───────────────────────────────────────────────
install_dependencies() {
    info "Checking system dependencies (curl, git, python3, tmux) for $OS_TYPE..."
    if [ "$OS_TYPE" = "debian" ]; then
        apt-get update -yqq
        apt-get install -yqq curl git python3 tmux build-essential
    elif [ "$OS_TYPE" = "rhel" ]; then
        dnf groupinstall -y "Development Tools" 2>/dev/null || yum groupinstall -y "Development Tools"
        dnf install -y curl git python3 tmux 2>/dev/null || yum install -y curl git python3 tmux
    elif [ "$OS_TYPE" = "alpine" ]; then
        apk add --no-cache curl git python3 tmux build-base bash
    elif [ "$OS_TYPE" = "macos" ]; then
        if ! command -v brew >/dev/null 2>&1; then
            error "Homebrew not found. Please install Homebrew first (https://brew.sh)"
        fi
        brew install git python3 tmux
    else
        warn "Unknown OS: please verify curl, git, python3, tmux, and build tools are installed."
    fi
}

# ── Node.js 22 ───────────────────────────────────────────────
install_node() {
    if command -v node >/dev/null 2>&1; then
        current=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
        if [ "$current" -ge "$NODE_MAJOR" ]; then
            info "Node.js $(node --version) already installed"
            return
        fi
        warn "Node.js $current found, upgrading to $NODE_MAJOR..."
    fi
    info "Installing Node.js ${NODE_MAJOR}.x..."
    if [ "$OS_TYPE" = "debian" ]; then
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
        apt-get install -y nodejs
    elif [ "$OS_TYPE" = "rhel" ]; then
        curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
        dnf install -y nodejs 2>/dev/null || yum install -y nodejs
    elif [ "$OS_TYPE" = "alpine" ]; then
        apk add --no-cache nodejs npm
    elif [ "$OS_TYPE" = "macos" ]; then
        brew install node@${NODE_MAJOR}
        brew link --overwrite node@${NODE_MAJOR}
    else
        error "Could not auto-install Node.js. Please install Node.js ${NODE_MAJOR} manually."
    fi
    info "Node.js $(node --version) installed"
}

# ── System user ───────────────────────────────────────────────
create_user() {
    if [ "$OS_TYPE" = "macos" ]; then
        info "Running on macOS — skipping system user creation (running as current user)"
        SERVICE_USER=$(whoami)
        return
    fi
    if id "$SERVICE_USER" &>/dev/null; then
        info "User $SERVICE_USER already exists"
    else
        if [ "$OS_TYPE" = "alpine" ]; then
            adduser -S -D -h "$INSTALL_DIR" -s /sbin/nologin "$SERVICE_USER"
        else
            useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
        fi
        info "Created system user: $SERVICE_USER"
    fi
}

# ── Clone / update repo ───────────────────────────────────────
install_code() {
    mkdir -p "$INSTALL_DIR"
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Updating existing installation..."
        git -C "$INSTALL_DIR" pull --ff-only
    else
        info "Cloning AgentOS from $REPO_URL..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
    npm install --omit=dev
    mkdir -p logs data
    if [ "$OS_TYPE" != "macos" ]; then
        chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    fi
    info "Code installed at $INSTALL_DIR"
}

# ── Environment ───────────────────────────────────────────────
setup_env() {
    if [ ! -f "$INSTALL_DIR/.env" ]; then
        if [ -f "$INSTALL_DIR/.env.example" ]; then
            cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
        else
            touch "$INSTALL_DIR/.env"
            echo "NODE_ENV=production" >> "$INSTALL_DIR/.env"
            echo "PORT=3000" >> "$INSTALL_DIR/.env"
        fi
        if [ "$OS_TYPE" != "macos" ]; then
            chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
        fi
        chmod 600 "$INSTALL_DIR/.env"
        warn "Created $INSTALL_DIR/.env — edit it before starting the service:"
        warn "  nano $INSTALL_DIR/.env"
    else
        info ".env already exists — skipping"
    fi
}

# ── macOS Launchd Setup ─────────────────────────────────────────
install_macos_launchd() {
    PLIST_PATH="/Library/LaunchDaemons/com.agentos.agent.plist"
    NODE_PATH=$(command -v node || echo "/usr/local/bin/node")
    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentos.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$INSTALL_DIR/bin/agentos.js</string>
        <string>gateway</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/logs/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/logs/launchd-stderr.log</string>
</dict>
</plist>
EOF
    launchctl load -w "$PLIST_PATH" 2>/dev/null || true
    info "macOS launchd service registered: com.agentos.agent.plist"
}

# ── Systemd service ───────────────────────────────────────────
install_service() {
    if [ "$OS_TYPE" = "macos" ]; then
        install_macos_launchd
        return
    fi

    NODE_PATH=$(command -v node || echo "/usr/bin/node")

    cat > /etc/systemd/system/agentos.service << EOF
[Unit]
Description=AgentOS Network Intelligence Platform
Documentation=https://github.com/br3eze-code/br3ezeclaw
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH bin/agentos.js gateway
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=agentos
Environment=NODE_ENV=production
EnvironmentFile=-$INSTALL_DIR/.env

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
ReadWritePaths=$INSTALL_DIR/logs $INSTALL_DIR/data $INSTALL_DIR/.agentos

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable agentos
    info "Systemd service installed: agentos.service"
}

# ── Firewall ──────────────────────────────────────────────────
open_ports() {
    if command -v ufw >/dev/null 2>&1; then
        ufw allow 3000/tcp comment "AgentOS HTTP" 2>/dev/null || true
        ufw allow 19876/tcp comment "AgentOS WebSocket" 2>/dev/null || true
        info "Firewall: opened ports 3000 and 19876 (ufw)"
    elif command -v firewall-cmd >/dev/null 2>&1; then
        firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
        firewall-cmd --permanent --add-port=19876/tcp 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
        info "Firewall: opened ports 3000 and 19876 (firewalld)"
    else
        warn "No firewall manager detected — ensure ports 3000 and 19876 are reachable"
    fi
}

# ── Validation ────────────────────────────────────────────────
validate_service() {
    info "Validating service configuration..."
    if [ "$OS_TYPE" = "macos" ]; then
        if [ ! -f "/Library/LaunchDaemons/com.agentos.agent.plist" ]; then
            error "launchd service plist is not properly configured."
        fi
    else
        if ! systemctl cat agentos >/dev/null 2>&1; then
            error "Systemd service is not properly configured."
        fi
    fi
    info "Service validation passed."
}

# ── Main ──────────────────────────────────────────────────────
main() {
    echo ""
    echo "  🤖  AgentOS Installer"
    echo "  ─────────────────────────────────────"
    echo ""

    install_dependencies
    install_node
    create_user
    install_code
    setup_env
    install_service
    open_ports
    validate_service

    if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
        HOST_IP=$(hostname -I | awk '{print $1}')
    else
        HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || ifconfig | grep -E 'inet.[0-9]' | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1 || echo "localhost")
    fi

    echo ""
    info "✅ AgentOS installed successfully"
    echo ""
    echo "  Next steps:"
    echo "  1. Edit your config:  nano $INSTALL_DIR/.env"
    if [ "$OS_TYPE" = "macos" ]; then
        echo "  2. Start the service: sudo launchctl load -w /Library/LaunchDaemons/com.agentos.agent.plist"
        echo "  3. Check status:      sudo launchctl list | grep agentos"
        echo "  4. View logs:         tail -f $INSTALL_DIR/logs/launchd-stderr.log"
    else
        echo "  2. Start the service: systemctl start agentos"
        echo "  3. Check status:      systemctl status agentos"
        echo "  4. View logs:         journalctl -u agentos -f"
    fi
    echo ""
    echo "  Endpoints (once started):"
    echo "    HTTP API:     http://${HOST_IP}:3000"
    echo "    WebSocket:    ws://${HOST_IP}:19876/ws"
    echo "    Health:       http://${HOST_IP}:3000/health"
    echo ""

    if [ ! -f "$INSTALL_DIR/.env" ] || grep -q "YOUR_BOT_TOKEN_HERE" "$INSTALL_DIR/.env" 2>/dev/null; then
        warn "⚠️  Edit $INSTALL_DIR/.env before starting the service!"
    fi
}

main "$@"
