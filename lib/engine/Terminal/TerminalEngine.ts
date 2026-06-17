import { Platform, NativeModules } from 'react-native'
import { Logger } from '@lib/state/Logger'

export interface TerminalCommand {
    id: string
    command: string
    output: string
    exitCode: number | null
    timestamp: number
    isRunning: boolean
}

export interface TerminalState {
    commands: TerminalCommand[]
    isRunning: boolean
    currentDirectory: string
    environment: Record<string, string>
    prootAvailable: boolean
    ubuntuReady: boolean
}

export type TerminalOutputCallback = (output: string, command: string) => void

let commandIdCounter = 0

class TerminalEngine {
    private state: TerminalState = {
        commands: [],
        isRunning: false,
        currentDirectory: '~',
        environment: {
            TERM: 'xterm-256color',
            HOME: '/data/data/com.chatterui/files',
            PATH: '/system/bin:/system/xbin:/data/data/com.chatterui/files',
        },
        prootAvailable: false,
        ubuntuReady: false,
    }

    private listeners: TerminalOutputCallback[] = []

    getState(): TerminalState {
        return { ...this.state }
    }

    onOutput(callback: TerminalOutputCallback) {
        this.listeners.push(callback)
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback)
        }
    }

    private emit(output: string, command: string) {
        for (const listener of this.listeners) {
            listener(output, command)
        }
    }

    async executeCommand(command: string): Promise<TerminalCommand> {
        const id = `cmd_${++commandIdCounter}`
        const cmd: TerminalCommand = {
            id,
            command,
            output: '',
            exitCode: null,
            timestamp: Date.now(),
            isRunning: true,
        }

        this.state.commands.push(cmd)
        this.state.isRunning = true
        Logger.info(`[Terminal] Executing: ${command}`)

        try {
            const result = await this.runProcess(command)
            cmd.output = result.stdout + (result.stderr ? '\n' + result.stderr : '')
            cmd.exitCode = result.exitCode
        } catch (error) {
            cmd.output = `Error: ${error instanceof Error ? error.message : String(error)}`
            cmd.exitCode = 1
        }

        cmd.isRunning = false
        this.state.isRunning = false
        this.emit(cmd.output, command)
        return cmd
    }

    async executeProotCommand(command: string, distro: string = 'ubuntu'): Promise<string> {
        const result = await this.runProcess(
            `proot-distro login ${distro} -- /bin/bash -c '${command.replace(/'/g, "'\\''")}'`
        )
        return result.stdout + (result.stderr ? '\n' + result.stderr : '')
    }

    async detectUbuntu(): Promise<boolean> {
        const result = await this.runProcess('which proot-distro 2>/dev/null && echo FOUND || echo NOT_FOUND')
        this.state.prootAvailable = result.stdout.includes('FOUND')
        return this.state.prootAvailable
    }

    async setupUbuntu(): Promise<string> {
        const output: string[] = []
        output.push('=== Setting up Ubuntu via proot-distro ===')
        output.push('')

        const hasPkg = await this.runProcess('which pkg 2>/dev/null || which apt 2>/dev/null')
        if (hasPkg.stdout) {
            output.push('[1/3] Installing proot-distro...')
            const install = await this.runProcess('pkg install -y proot-distro 2>&1')
            output.push(install.stdout + (install.stderr ? '\n' + install.stderr : ''))
        } else {
            output.push('[!] pkg/apt not found. Trying alternative installation...')
            const installAlt = await this.runProcess(
                'curl -sL https://termux.dev/install.sh 2>/dev/null | bash 2>&1 || ' +
                'apt update && apt install -y proot-distro 2>&1'
            )
            output.push(installAlt.stdout + (installAlt.stderr ? '\n' + installAlt.stderr : ''))
        }

        output.push('')
        output.push('[2/3] Checking proot-distro availability...')
        const check = await this.detectUbuntu()
        if (!check) {
            output.push('[!] proot-distro not found after install.')
            output.push('[!] Alternative: install Termux and run: pkg install proot-distro')
            output.push('[!] Then from Termux: proot-distro install ubuntu')
            return output.join('\n')
        }
        output.push('[OK] proot-distro found')

        output.push('')
        output.push('[3/3] Installing Ubuntu...')
        const installUbuntu = await this.runProcess('proot-distro install ubuntu 2>&1')
        output.push(installUbuntu.stdout + (installUbuntu.stderr ? '\n' + installUbuntu.stderr : ''))
        this.state.ubuntuReady = true

        output.push('')
        output.push('=== Ubuntu ready! Use "ubuntu" command to enter ===')
        return output.join('\n')
    }

    private async runProcess(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        if (Platform.OS !== 'android') {
            return this.simulateCommand(command)
        }

        try {
            const NativeShell = NativeModules.NativeShell

            if (NativeShell?.executeCommand) {
                const result = await NativeShell.executeCommand(
                    command,
                    JSON.stringify(this.state.environment),
                    this.state.currentDirectory
                )
                return {
                    stdout: result.stdout || '',
                    stderr: result.stderr || '',
                    exitCode: result.exitCode ?? 0,
                }
            }

            return this.simulateCommand(command)
        } catch (error) {
            return {
                stdout: '',
                stderr: error instanceof Error ? error.message : String(error),
                exitCode: 1,
            }
        }
    }

    private simulateCommand(command: string): { stdout: string; stderr: string; exitCode: number } {
        const parts = this.parseCommand(command)
        const cmd = parts[0]
        const args = parts.slice(1)

        if (cmd === 'echo') {
            return { stdout: args.join(' ').replace(/^["']|["']$/g, ''), stderr: '', exitCode: 0 }
        }
        if (cmd === 'pwd') {
            return { stdout: this.state.currentDirectory === '~' ? '/data/data/com.chatterui/files' : this.state.currentDirectory, stderr: '', exitCode: 0 }
        }
        if (cmd === 'cd') {
            const target = args[0] || '~'
            this.state.currentDirectory = target
            return { stdout: '', stderr: '', exitCode: 0 }
        }
        if (cmd === 'ls') {
            return { stdout: 'Documents  Download  Music  Pictures  Storage  ubuntu-rootfs', stderr: '', exitCode: 0 }
        }
        if (cmd === 'whoami') {
            return { stdout: 'u0_a' + Math.floor(Math.random() * 999), stderr: '', exitCode: 0 }
        }
        if (cmd === 'date') {
            return { stdout: new Date().toString(), stderr: '', exitCode: 0 }
        }
        if (cmd === 'uname') {
            if (args.includes('-a')) return { stdout: 'Linux aarch64 Android 14', stderr: '', exitCode: 0 }
            return { stdout: 'Linux', stderr: '', exitCode: 0 }
        }
        if (cmd === 'which') {
            if (args[0] === 'proot-distro') return { stdout: '', stderr: '', exitCode: 1 }
            return { stdout: `/system/bin/${args[0] || ''}`, stderr: '', exitCode: 0 }
        }
        if (cmd === 'id') {
            return { stdout: 'uid=10000(u0_a0) gid=10000(u0_a0)', stderr: '', exitCode: 0 }
        }
        if (cmd === 'cat') {
            return { stdout: `[File content of ${args[0] || 'empty'}]`, stderr: '', exitCode: 0 }
        }
        if (cmd === 'mkdir') {
            return { stdout: '', stderr: '', exitCode: 0 }
        }
        if (cmd === 'touch') {
            return { stdout: '', stderr: '', exitCode: 0 }
        }
        if (cmd === 'curl' || cmd === 'wget') {
            return { stdout: `[Network request would be executed on real device]`, stderr: '', exitCode: 0 }
        }

        return {
            stdout: `${cmd}: command simulated in dev mode. On real device, NativeShell executes this.`,
            stderr: '',
            exitCode: 0,
        }
    }

    private parseCommand(command: string): string[] {
        const parts: string[] = []
        let current = ''
        let inSingle = false
        let inDouble = false
        let escaped = false

        for (const ch of command) {
            if (escaped) { current += ch; escaped = false; continue }
            if (ch === '\\') { escaped = true; continue }
            if (ch === "'" && !inDouble) { inSingle = !inSingle; continue }
            if (ch === '"' && !inSingle) { inDouble = !inDouble; continue }
            if (ch === ' ' && !inSingle && !inDouble) {
                if (current) { parts.push(current); current = '' }
                continue
            }
            current += ch
        }
        if (current) parts.push(current)
        return parts
    }

    clearHistory() { this.state.commands = [] }
    getHistory(): TerminalCommand[] { return [...this.state.commands] }
    setCurrentDirectory(dir: string) { this.state.currentDirectory = dir }
    setEnvironment(env: Record<string, string>) { this.state.environment = { ...this.state.environment, ...env } }
}

export const terminalEngine = new TerminalEngine()
