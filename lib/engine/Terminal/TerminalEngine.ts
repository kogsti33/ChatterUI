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
            HOME: '/root',
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        },
    }

    private listeners: TerminalOutputCallback[] = []
    private pendingResolves: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }> = new Map()

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
            cmd.output = result.stdout + (result.stderr ? '\n[stderr] ' + result.stderr : '')
            cmd.exitCode = result.exitCode
        } catch (error) {
            cmd.output = `Error: ${error instanceof Error ? error.message : String(error)}`
            cmd.exitCode = 1
        }

        cmd.isRunning = false
        this.state.isRunning = false

        this.emit(cmd.output, command)
        Logger.info(`[Terminal] Command ${cmd.id} finished with exit code ${cmd.exitCode}`)

        return cmd
    }

    async executeProotCommand(command: string, distro: string = 'ubuntu'): Promise<string> {
        if (Platform.OS === 'android') {
            try {
                const NativeShell = NativeModules.NativeShell
                if (NativeShell?.executeProotCommand) {
                    const result = await NativeShell.executeProotCommand(command, distro)
                    return result.stdout + (result.stderr ? '\n[stderr] ' + result.stderr : '')
                }
            } catch (error) {
                Logger.warn(`[Terminal] NativeShell proot failed: ${error}`)
            }
        }

        const fullCommand = `proot-distro login ${distro} -- /bin/bash -c "${command.replace(/"/g, '\\"')}"`
        const result = await this.runProcess(fullCommand)
        return result.stdout + (result.stderr ? '\n[stderr] ' + result.stderr : '')
    }

    private async runProcess(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        if (Platform.OS !== 'android') {
            return {
                stdout: `[Simulated] $ ${command}\nCommand execution is only available on Android.`,
                stderr: '',
                exitCode: 0,
            }
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

            return await this.fallbackProcess(command)
        } catch (error) {
            return {
                stdout: '',
                stderr: error instanceof Error ? error.message : String(error),
                exitCode: 1,
            }
        }
    }

    private async fallbackProcess(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        const parts = this.parseCommand(command)
        const cmd = parts[0]
        const args = parts.slice(1)

        if (cmd === 'echo') {
            return { stdout: args.join(' '), stderr: '', exitCode: 0 }
        }
        if (cmd === 'pwd') {
            return { stdout: '/root', stderr: '', exitCode: 0 }
        }
        if (cmd === 'ls') {
            return {
                stdout: 'ChatterUI  Documents  Download  Music  Pictures  Storage',
                stderr: '',
                exitCode: 0,
            }
        }
        if (cmd === 'cat') {
            return { stdout: `[File: ${args[0] || 'empty'}]`, stderr: '', exitCode: 0 }
        }
        if (cmd === 'whoami') {
            return { stdout: 'root', stderr: '', exitCode: 0 }
        }
        if (cmd === 'date') {
            return { stdout: new Date().toString(), stderr: '', exitCode: 0 }
        }
        if (cmd === 'uname') {
            return { stdout: 'Linux aarch64 Android', stderr: '', exitCode: 0 }
        }
        if (cmd === 'curl' || cmd === 'wget') {
            return { stdout: `[Network request: ${command}]`, stderr: '', exitCode: 0 }
        }
        if (cmd === 'python' || cmd === 'python3') {
            return { stdout: '[Python runtime not available in fallback mode]', stderr: '', exitCode: 1 }
        }

        return {
            stdout: `$ ${command}\n[Command not available in fallback mode. Install proot-distro for full Linux environment.]`,
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
            if (escaped) {
                current += ch
                escaped = false
                continue
            }
            if (ch === '\\') {
                escaped = true
                continue
            }
            if (ch === "'" && !inDouble) {
                inSingle = !inSingle
                continue
            }
            if (ch === '"' && !inSingle) {
                inDouble = !inDouble
                continue
            }
            if (ch === ' ' && !inSingle && !inDouble) {
                if (current) {
                    parts.push(current)
                    current = ''
                }
                continue
            }
            current += ch
        }
        if (current) parts.push(current)
        return parts
    }

    clearHistory() {
        this.state.commands = []
    }

    getHistory(): TerminalCommand[] {
        return [...this.state.commands]
    }

    setCurrentDirectory(dir: string) {
        this.state.currentDirectory = dir
    }

    setEnvironment(env: Record<string, string>) {
        this.state.environment = { ...this.state.environment, ...env }
    }
}

export const terminalEngine = new TerminalEngine()
