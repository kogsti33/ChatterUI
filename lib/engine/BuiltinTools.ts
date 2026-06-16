import { toolRegistry, Tool, ToolDefinition } from './ToolCalling'
import { terminalEngine } from './Terminal/TerminalEngine'
import { Logger } from '@lib/state/Logger'

const shellTool: Tool = {
    definition: {
        name: 'execute_shell',
        description: 'Execute a shell command on the device. Supports Linux commands via proot-distro.',
        parameters: {
            command: {
                type: 'string',
                description: 'The shell command to execute',
                required: true,
            },
            distro: {
                type: 'string',
                description: 'Linux distribution to use (default: ubuntu)',
                required: false,
            },
        },
    },
    execute: async (args) => {
        const command = args.command as string
        const distro = (args.distro as string) || 'ubuntu'

        if (!command) throw new Error('command is required')

        Logger.info(`[Tool:shell] Executing: ${command}`)
        const result = await terminalEngine.executeProotCommand(command, distro)
        return result || '[Command completed with no output]'
    },
}

const readFileTool: Tool = {
    definition: {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
            path: {
                type: 'string',
                description: 'Path to the file to read',
                required: true,
            },
        },
    },
    execute: async (args) => {
        const path = args.path as string
        const result = await terminalEngine.executeProotCommand(`cat "${path}"`)
        return result
    },
}

const writeFileTool: Tool = {
    definition: {
        name: 'write_file',
        description: 'Write content to a file',
        parameters: {
            path: {
                type: 'string',
                description: 'Path to the file to write',
                required: true,
            },
            content: {
                type: 'string',
                description: 'Content to write to the file',
                required: true,
            },
        },
    },
    execute: async (args) => {
        const path = args.path as string
        const content = (args.content as string).replace(/'/g, "'\\''")
        await terminalEngine.executeProotCommand(`echo '${content}' > "${path}"`)
        return `File written to ${path}`
    },
}

const listFilesTool: Tool = {
    definition: {
        name: 'list_files',
        description: 'List files and directories at a path',
        parameters: {
            path: {
                type: 'string',
                description: 'Directory path to list (default: current directory)',
                required: false,
            },
        },
    },
    execute: async (args) => {
        const path = (args.path as string) || '.'
        const result = await terminalEngine.executeProotCommand(`ls -la "${path}"`)
        return result || '[Empty directory]'
    },
}

const searchFilesTool: Tool = {
    definition: {
        name: 'search_files',
        description: 'Search for files or grep for content in files',
        parameters: {
            pattern: {
                type: 'string',
                description: 'Search pattern (supports grep regex)',
                required: true,
            },
            path: {
                type: 'string',
                description: 'Directory to search in (default: current directory)',
                required: false,
            },
        },
    },
    execute: async (args) => {
        const pattern = args.pattern as string
        const path = (args.path as string) || '.'
        const result = await terminalEngine.executeProotCommand(`grep -r "${pattern}" "${path}" 2>/dev/null | head -50`)
        return result || '[No matches found]'
    },
}

const systemInfoTool: Tool = {
    definition: {
        name: 'system_info',
        description: 'Get system information (OS, architecture, memory, disk usage)',
        parameters: {},
    },
    execute: async () => {
        const result = await terminalEngine.executeProotCommand(
            'uname -a && echo "---" && free -h 2>/dev/null && echo "---" && df -h / 2>/dev/null && echo "---" && cat /etc/os-release 2>/dev/null | head -5'
        )
        return result
    },
}

const installPackageTool: Tool = {
    definition: {
        name: 'install_package',
        description: 'Install a package using apt-get',
        parameters: {
            package: {
                type: 'string',
                description: 'Package name to install',
                required: true,
            },
        },
    },
    execute: async (args) => {
        const pkg = args.package as string
        Logger.info(`[Tool:install] Installing package: ${pkg}`)
        const result = await terminalEngine.executeProotCommand(`apt-get update -qq && apt-get install -y ${pkg} 2>&1 | tail -20`)
        return result
    },
}

export function registerBuiltinTools() {
    toolRegistry.register(shellTool)
    toolRegistry.register(readFileTool)
    toolRegistry.register(writeFileTool)
    toolRegistry.register(listFilesTool)
    toolRegistry.register(searchFilesTool)
    toolRegistry.register(systemInfoTool)
    toolRegistry.register(installPackageTool)
    Logger.info(`[ToolCalling] Registered ${toolRegistry.getAll().length} tools`)
}
