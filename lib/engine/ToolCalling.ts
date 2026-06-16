import { NativeModules } from 'react-native'
import { Logger } from '@lib/state/Logger'

export interface ToolParameter {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object'
    description: string
    required?: boolean
    enum?: string[]
    items?: { type: string }
}

export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, ToolParameter>
}

export interface ToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
}

export interface ToolResult {
    tool_call_id: string
    name: string
    content: string
    success: boolean
}

export interface Tool {
    definition: ToolDefinition
    execute: (args: Record<string, unknown>) => Promise<string>
}

class ToolRegistry {
    private tools: Map<string, Tool> = new Map()

    register(tool: Tool) {
        this.tools.set(tool.definition.name, tool)
    }

    unregister(name: string) {
        this.tools.delete(name)
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name)
    }

    getAll(): Tool[] {
        return Array.from(this.tools.values())
    }

    getDefinitions(): ToolDefinition[] {
        return this.getAll().map(t => t.definition)
    }

    async execute(toolCall: ToolCall): Promise<ToolResult> {
        const tool = this.tools.get(toolCall.name)
        if (!tool) {
            return {
                tool_call_id: toolCall.id,
                name: toolCall.name,
                content: `Error: Tool "${toolCall.name}" not found`,
                success: false,
            }
        }

        try {
            Logger.info(`[ToolCalling] Executing ${toolCall.name}`)
            const content = await tool.execute(toolCall.arguments)
            Logger.info(`[ToolCalling] ${toolCall.name} completed`)
            return { tool_call_id: toolCall.id, name: toolCall.name, content, success: true }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            Logger.error(`[ToolCalling] ${toolCall.name} failed: ${msg}`)
            return { tool_call_id: toolCall.id, name: toolCall.name, content: `Error: ${msg}`, success: false }
        }
    }
}

export const toolRegistry = new ToolRegistry()

export function parseToolCalls(text: string): ToolCall[] {
    const calls: ToolCall[] = []

    const jsonBlockRegex = /```json\s*\n?(\{[\s\S]*?\})\s*\n?```/g
    let match
    while ((match = jsonBlockRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1])
            if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
                for (const call of parsed.tool_calls) {
                    calls.push({
                        id: call.id || `call_${Date.now()}_${calls.length}`,
                        name: call.name || call.function?.name || '',
                        arguments: call.arguments || call.function?.arguments || {},
                    })
                }
            } else if (parsed.name && typeof parsed.name === 'string') {
                calls.push({
                    id: parsed.id || `call_${Date.now()}`,
                    name: parsed.name,
                    arguments: parsed.arguments || {},
                })
            }
        } catch {}
    }

    const funcCallRegex = /<tool_call>\s*\n?(\{[\s\S]*?\})\s*\n?<\/tool_call>/g
    while ((match = funcCallRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1])
            calls.push({
                id: parsed.id || `call_${Date.now()}_${calls.length}`,
                name: parsed.name || '',
                arguments: parsed.arguments || {},
            })
        } catch {}
    }

    return calls
}

export async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = []
    for (const call of toolCalls) {
        const result = await toolRegistry.execute(call)
        results.push(result)
    }
    return results
}

export function formatToolResults(results: ToolResult[]): string {
    return results
        .map(r => `<tool_result id="${r.tool_call_id}" tool="${r.name}" success="${r.success}">\n${r.content}\n</tool_result>`)
        .join('\n\n')
}

export function formatToolsForPrompt(tools: ToolDefinition[]): string {
    if (tools.length === 0) return ''

    const toolDefs = tools.map(t => {
        const params = Object.entries(t.parameters)
            .map(([name, p]) => {
                let desc = `  - ${name} (${p.type})${p.required ? ', required' : ''}: ${p.description}`
                if (p.enum) desc += ` [values: ${p.enum.join(', ')}]`
                return desc
            })
            .join('\n')

        return `### ${t.name}\n${t.description}\nParameters:\n${params}`
    })

    return `<available_tools>
${toolDefs}

To call a tool, respond with a JSON block:
\`\`\`json
{
  "tool_calls": [{
    "name": "tool_name",
    "arguments": { "param": "value" }
  }]
}
\`\`\`

After receiving tool results, continue your response.
</available_tools>`
}

export function hasToolCalls(text: string): boolean {
    return /```json\s*\n?\{[\s\S]*?"tool_calls"/.test(text) ||
           /<tool_call>\s*\n?\{/.test(text)
}
