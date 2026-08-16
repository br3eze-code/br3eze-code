import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

/**
 * AgentOS Tailscale Integration
 * Handles diagnostics and status reporting for Tailscale VPN.
 */
class Tailscale {
    constructor() {
        this.isWindows = process.platform === 'win32';
        this._bin = null;
    }

    get bin() {
        if (this._bin) return this._bin;
        if (!this.isWindows) {
            this._bin = 'tailscale';
            return this._bin;
        }

        try {
            execSync('tailscale version', { stdio: 'ignore' });
            this._bin = 'tailscale';
            return this._bin;
        } catch (e) {
            const paths = [
                path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
                path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe'),
                path.join(process.env.LOCALAPPDATA || '', 'Tailscale', 'tailscale.exe')
            ];
            for (const p of paths) {
                if (fs.existsSync(p)) {
                    this._bin = `"${p}"`;
                    return this._bin;
                }
            }
        }
        this._bin = 'tailscale';
        return this._bin;
    }

    /**
     * Check if Tailscale is installed and accessible
     * @returns {Promise<{installed: boolean, version: string|null}>}
     */
    async getStatus() {
        try {
            const output = execSync(`${this.bin} version`, { stdio: 'pipe', encoding: 'utf8' });
            const version = output.split('\n')[0].trim();
            return { installed: true, version };
        } catch (e) {
            return { installed: false, version: null };
        }
    }

    /**
     * Get detailed status including Tail-IP and login status
     * @returns {Promise<{online: boolean, ip: string|null, user: string|null, device: string|null}>}
     */
    async getDetailedStatus() {
        try {
            const output = execSync(`${this.bin} status --json`, { stdio: 'pipe', encoding: 'utf8' });
            const data = JSON.parse(output);

            if (data.Self) {
                return {
                    online: data.Self.Online,
                    ip: data.Self.TailscaleIPs ? data.Self.TailscaleIPs[0] : null,
                    user: data.Self.User,
                    device: data.Self.HostName
                };
            }
            return { online: false, ip: null, user: null, device: null };
        } catch (e) {
            // Fallback if --json is not supported or fails
            try {
                const ipOutput = execSync(`${this.bin} ip -4`, { stdio: 'pipe', encoding: 'utf8' }).trim();
                return { online: !!ipOutput, ip: ipOutput || null, user: 'unknown', device: 'unknown' };
            } catch (_) {
                return { online: false, ip: null, user: null, device: null };
            }
        }
    }

    /**
     * Check if Tailscale service is running (Windows specific)
     * @returns {Promise<boolean>}
     */
    async isServiceRunning() {
        if (!this.isWindows) return true; // Assume true on Linux/macOS if binary is found
        try {
            const output = execSync('powershell -Command "Get-Service tailscale | Select-Object -ExpandProperty Status"', { stdio: 'pipe', encoding: 'utf8' }).trim();
            return output === 'Running';
        } catch (e) {
            return false;
        }
    }
}

export default new Tailscale();
