const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const PLUGIN_NAME = 'nativeshell-plugin'
const PLUGIN_VERSION = '1.0.0'

function buildKotlinModule(pkgName) {
    const lines = [
        'package ' + pkgName + '.nativeshell',
        '',
        'import com.facebook.react.bridge.*',
        '',
        'class NativeShellModule(reactContext: ReactApplicationContext) :',
        '    ReactContextBaseJavaModule(reactContext) {',
        '',
        '    override fun getName(): String = "NativeShell"',
        '',
        '    @ReactMethod',
        '    fun executeCommand(command: String, envJson: String, cwd: String, promise: Promise) {',
        '        Thread {',
        '            try {',
        '                val env = mutableMapOf<String, String>()',
        '                try {',
        '                    val jsonObj = org.json.JSONObject(envJson)',
        '                    for (key in jsonObj.keys()) {',
        '                        env[key] = jsonObj.getString(key)',
        '                    }',
        '                } catch (_: Exception) {}',
        '',
        '                val pb = ProcessBuilder(listOf("/system/bin/sh", "-c", command))',
        '                pb.directory(java.io.File(cwd.ifEmpty { "/data/data/' + pkgName + '/files" }))',
        '                pb.redirectErrorStream(false)',
        '',
        '                val processEnv = pb.environment()',
        '                processEnv.putAll(env)',
        '                processEnv["HOME"] = "/data/data/' + pkgName + '/files"',
        '                processEnv["PATH"] = "/system/bin:/system/xbin"',
        '                processEnv["TERM"] = "xterm-256color"',
        '',
        '                val process = pb.start()',
        '                val stdout = process.inputStream.bufferedReader().readText()',
        '                val stderr = process.errorStream.bufferedReader().readText()',
        '                val exitCode = process.waitFor()',
        '',
        '                val result = Arguments.createMap()',
        '                result.putString("stdout", stdout)',
        '                result.putString("stderr", stderr)',
        '                result.putInt("exitCode", exitCode)',
        '                promise.resolve(result)',
        '            } catch (e: Exception) {',
        '                promise.reject("SHELL_ERROR", e.message, e)',
        '            }',
        '        }.start()',
        '    }',
        '',
        '    @ReactMethod',
        '    fun executeProotCommand(command: String, distro: String, promise: Promise) {',
        '        Thread {',
        '            try {',
        '                val pb = ProcessBuilder(listOf(',
        '                    "/system/bin/sh", "-c",',
        '                    "proot-distro login " + distro + " -- /bin/bash -c " + command',
        '                ))',
        '                pb.redirectErrorStream(false)',
        '                val process = pb.start()',
        '                val stdout = process.inputStream.bufferedReader().readText()',
        '                val stderr = process.errorStream.bufferedReader().readText()',
        '                val exitCode = process.waitFor()',
        '                val result = Arguments.createMap()',
        '                result.putString("stdout", stdout)',
        '                result.putString("stderr", stderr)',
        '                result.putInt("exitCode", exitCode)',
        '                promise.resolve(result)',
        '            } catch (e: Exception) {',
        '                promise.reject("PROOT_ERROR", e.message, e)',
        '            }',
        '        }.start()',
        '    }',
        '',
        '    @ReactMethod',
        '    fun isProotAvailable(promise: Promise) {',
        '        Thread {',
        '            try {',
        '                val pb = ProcessBuilder(listOf("/system/bin/sh", "-c", "which proot-distro 2>/dev/null || echo not_found"))',
        '                val process = pb.start()',
        '                val output = process.inputStream.bufferedReader().readText().trim()',
        '                process.waitFor()',
        '                promise.resolve(output != "not_found")',
        '            } catch (e: Exception) {',
        '                promise.resolve(false)',
        '            }',
        '        }.start()',
        '    }',
        '}',
    ]
    return lines.join('\n') + '\n'
}

function buildKotlinPackage(pkgName) {
    const lines = [
        'package ' + pkgName + '.nativeshell',
        '',
        'import com.facebook.react.ReactPackage',
        'import com.facebook.react.bridge.NativeModule',
        'import com.facebook.react.bridge.ReactApplicationContext',
        'import com.facebook.react.uimanager.ViewManager',
        '',
        'class NativeShellPackage : ReactPackage {',
        '    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {',
        '        return listOf(NativeShellModule(reactContext))',
        '    }',
        '',
        '    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {',
        '        return emptyList()',
        '    }',
        '}',
    ]
    return lines.join('\n') + '\n'
}

const withNativeShell = (config) => {
    config = withDangerousMod(config, [
        'android',
        (config) => {
            const { projectRoot } = config.modRequest
            const javaDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java')

            function findMainApplication(dir) {
                if (!fs.existsSync(dir)) return null
                const entries = fs.readdirSync(dir, { withFileTypes: true })
                for (const e of entries) {
                    if (e.isFile() && e.name.includes('MainApplication')) {
                        return path.join(dir, e.name)
                    }
                    if (e.isDirectory()) {
                        const result = findMainApplication(path.join(dir, e.name))
                        if (result) return result
                    }
                }
                return null
            }

            const mainAppPath = findMainApplication(javaDir)
            if (!mainAppPath) {
                console.warn('NativeShell: MainApplication.kt not found, skipping.')
                return config
            }

            const pkgDir = path.dirname(mainAppPath)
            const nativeshellDir = path.join(pkgDir, 'nativeshell')
            fs.mkdirSync(nativeshellDir, { recursive: true })

            const pkgName = path.basename(path.dirname(mainAppPath))

            fs.writeFileSync(path.join(nativeshellDir, 'NativeShellModule.kt'), buildKotlinModule(pkgName))
            fs.writeFileSync(path.join(nativeshellDir, 'NativeShellPackage.kt'), buildKotlinPackage(pkgName))

            let content = fs.readFileSync(mainAppPath, 'utf8')
            if (!content.includes('NativeShellPackage')) {
                content = content.replace(
                    /import\s+/,
                    'import ' + pkgName + '.nativeshell.NativeShellPackage\nimport '
                )
                content = content.replace(
                    /packages\s*\+=\s*listOf\(/,
                    'packages += listOf(\n                NativeShellPackage(),\n                '
                )
                fs.writeFileSync(mainAppPath, content)
            }

            return config
        },
    ])
    return config
}

module.exports = createRunOncePlugin(withNativeShell, PLUGIN_NAME, PLUGIN_VERSION)
