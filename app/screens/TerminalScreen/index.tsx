import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
    View,
    Text,
    TextInput,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Theme } from '@lib/theme/ThemeManager'
import { terminalEngine, TerminalCommand } from '@lib/engine/Terminal/TerminalEngine'

const PROMPT = '$ '
const MAX_HISTORY = 200

const TerminalScreen = () => {
    const { color } = Theme.useTheme()
    const insets = useSafeAreaInsets()
    const [input, setInput] = useState('')
    const [history, setHistory] = useState<TerminalCommand[]>([])
    const [commandHistory, setCommandHistory] = useState<string[]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)
    const [isRunning, setIsRunning] = useState(false)
    const scrollViewRef = useRef<ScrollView>(null)
    const inputRef = useRef<TextInput>(null)

    const scrollToBottom = useCallback(() => {
        setTimeout(() => {
            scrollViewRef.current?.scrollToEnd({ animated: false })
        }, 50)
    }, [])

    useEffect(() => {
        const unsubscribe = terminalEngine.onOutput((output, command) => {
            scrollToBottom()
        })
        return unsubscribe
    }, [scrollToBottom])

    useEffect(() => {
        scrollToBottom()
    }, [history, scrollToBottom])

    const handleSend = useCallback(async () => {
        const command = input.trim()
        if (!command || isRunning) return

        setInput('')
        setCommandHistory(prev => {
            const next = [command, ...prev.filter(c => c !== command)]
            return next.slice(0, MAX_HISTORY)
        })
        setHistoryIndex(-1)
        setIsRunning(true)

        try {
            const result = await terminalEngine.executeCommand(command)
            setHistory(prev => [...prev, result])
        } catch (error) {
            setHistory(prev => [
                ...prev,
                {
                    id: `err_${Date.now()}`,
                    command,
                    output: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    exitCode: 1,
                    timestamp: Date.now(),
                    isRunning: false,
                },
            ])
        } finally {
            setIsRunning(false)
        }
    }, [input, isRunning])

    const handleKeyDown = useCallback(
        (key: string) => {
            if (key === 'ArrowUp') {
                if (commandHistory.length > 0) {
                    const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1)
                    setHistoryIndex(newIndex)
                    setInput(commandHistory[newIndex])
                }
            } else if (key === 'ArrowDown') {
                if (historyIndex > 0) {
                    const newIndex = historyIndex - 1
                    setHistoryIndex(newIndex)
                    setInput(commandHistory[newIndex])
                } else {
                    setHistoryIndex(-1)
                    setInput('')
                }
            }
        },
        [commandHistory, historyIndex]
    )

    const clearTerminal = useCallback(() => {
        setHistory([])
        terminalEngine.clearHistory()
    }, [])

    const renderCommand = (cmd: TerminalCommand) => (
        <View key={cmd.id} style={styles.commandBlock}>
            <View style={[styles.promptLine, { flexDirection: 'row', alignItems: 'center' }]}>
                <Text style={[styles.prompt, { color: '#4ECDC4' }]}>{PROMPT}</Text>
                <Text style={[styles.commandText, { color: '#E0E0E0' }]}>{cmd.command}</Text>
            </View>
            {cmd.output ? (
                <Text style={[styles.outputText, { color: cmd.exitCode === 0 ? '#CCCCCC' : '#FF6B6B' }]}>
                    {cmd.output}
                </Text>
            ) : null}
        </View>
    )

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: '#1E1E1E', paddingBottom: 0 }]} edges={['top', 'left', 'right']}>
            <View style={[styles.header, { borderBottomColor: '#333' }]}>
                <Text style={[styles.headerTitle, { color: '#4ECDC4' }]}>Terminal</Text>
                <View style={styles.headerButtons}>
                    <TouchableOpacity onPress={clearTerminal} style={styles.headerButton}>
                        <Text style={[styles.headerButtonText, { color: '#888' }]}>Clear</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView
                ref={scrollViewRef}
                style={[styles.output, { backgroundColor: '#1E1E1E' }]}
                contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 100 }}
                keyboardDismissMode="interactive"
                onContentSizeChange={scrollToBottom}
            >
                <Text style={[styles.welcomeText, { color: '#666' }]}>
                    Ubuntu Terminal via proot-distro{'\n'}
                    Type commands below. Use execute_shell tool for AI-driven execution.
                </Text>

                {history.map(renderCommand)}

                {isRunning && (
                    <View style={styles.promptLine}>
                        <Text style={[styles.prompt, { color: '#4ECDC4' }]}>{PROMPT}</Text>
                        <Text style={[styles.commandText, { color: '#888', fontStyle: 'italic' }]}>Running...</Text>
                    </View>
                )}
            </ScrollView>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={0}
            >
                <View style={[styles.inputContainer, { backgroundColor: '#2D2D2D', borderTopColor: '#333', paddingBottom: Math.max(insets.bottom, 8) }]}>
                    <Text style={[styles.inputPrompt, { color: '#4ECDC4' }]}>{PROMPT}</Text>
                    <TextInput
                        ref={inputRef}
                        style={[styles.input, { color: '#E0E0E0' }]}
                        value={input}
                        onChangeText={setInput}
                        onSubmitEditing={handleSend}
                        placeholder={isRunning ? 'Waiting...' : 'Enter command...'}
                        placeholderTextColor="#666"
                        editable={!isRunning}
                        autoCapitalize="none"
                        autoCorrect={false}
                        selectTextOnFocus
                    />
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    headerButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    headerButton: {
        padding: 4,
    },
    headerButtonText: {
        fontSize: 14,
    },
    output: {
        flex: 1,
    },
    welcomeText: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 12,
        marginBottom: 16,
        lineHeight: 18,
    },
    commandBlock: {
        marginBottom: 8,
    },
    promptLine: {
        flexDirection: 'row',
    },
    prompt: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 13,
        fontWeight: '600',
    },
    commandText: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 13,
        flex: 1,
    },
    outputText: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 12,
        marginTop: 4,
        marginLeft: 16,
        lineHeight: 18,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: 1,
    },
    inputPrompt: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 14,
        fontWeight: '600',
        marginRight: 4,
    },
    input: {
        flex: 1,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 14,
        paddingVertical: 4,
    },
})

export default TerminalScreen
