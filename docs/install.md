# Installation Guide

## Quick Start (Recommended)

```bash
git clone https://github.com/br3eze-code/br3eze-code.git
cd br3eze-code
cp .env.example .env
# Edit .env with your Gemini API key, MikroTik credentials, Firebase, etc.
npm install
# postinstall creates ~/.local/bin/agentos and updates your shell rc
source ~/.bashrc  # use ~/.zshrc for zsh
agentos onboard
npm start
