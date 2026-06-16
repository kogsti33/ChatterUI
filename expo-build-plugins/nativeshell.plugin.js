const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const PLUGIN_NAME = 'nativeshell-plugin'
const PLUGIN_VERSION = '1.0.0'

const NATIVE_SHELL_KT = `package com.chatterui.nativeshell

import android.util.Base64
import com.facebook.react.bridge.*

class NativeShellModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NativeShell"

    @ReactMethod
    fun executeCommand(command: String, envJson: String, cwd: String, promise: Promise) {
        Thread {
            try {
                val env = mutableMapOf<String, String>()
                try {
                    val jsonObj = org.json.JSONObject(envJson)
                    for (key in jsonObj.keys()) {
                        env[key] = jsonObj.getString(key)
                    }
                } catch (_: Exception) {}

                val pb = ProcessBuilder(listOf("/system/bin/sh", "-c", command))
                pb.directory(java.io.File(cwd.ifEmpty { "/data/data/com.chatterui/files" }))
                pb.redirectErrorStream(false)

                val processEnv = pb.environment()
                processEnv.putAll(env)
                processEnv["HOME"] = "/data/data/com.chatterui/files"
                processEnv["PATH"] = "/system/bin:/system/xbin"
                processEnv["TERM"] = "xterm-256color"

                val process = pb.start()

                val stdout = process.inputStream.bufferedReader().readText()
                val stderr = process.errorStream.bufferedReader().readText()
                val exitCode = process.waitFor()

                val result = Arguments.createMap()
                result.putString("stdout", stdout)
                result.putString("stderr", stderr)
                result.putInt("exitCode", exitCode)
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("SHELL_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun executeProotCommand(command: String, distro: String, promise: Promise) {
        Thread {
            try {
                val prootCmd = "proot-distro login $distro -- /bin/bash -c \${command.replaceDoubleQuotes()}"
                val pb = ProcessBuilder(listOf("/system/bin/sh", "-c", prootCmd))
                pb.redirectErrorStream(false)

                val process = pb.start()
                val stdout = process.inputStream.bufferedReader().readText()
                val stderr = process.errorStream.bufferedReader().readText()
                val exitCode = process.waitFor()

                val result = Arguments.createMap()
                result.putString("stdout", stdout)
                result.putString("stderr", stderr)
                result.putInt("exitCode", exitCode)
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("PROOT_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun isProotAvailable(promise: Promise) {
        Thread {
            try {
                val pb = ProcessBuilder(listOf("/system/bin/sh", "-c", "which proot-distro 2>/dev/null || echo not_found"))
                val process = pb.start()
                val output = process.inputStream.bufferedReader().readText().trim()
                process.waitFor()
                promise.resolve(output != "not_found")
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }.start()
    }
}

private fun String.replaceDoubleQuotes(): String {
    return this.replace("\\\"", "\\\\\"").replace("\"", "\\\\\"")
}
`

const NATIVE_SHELL_PACKAGE_KT = `package com.chatterui.nativeshell

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class NativeShellPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(NativeShellModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`

const withNativeShell = (config) => {
    config = withDangerousMod(config, [
        'android',
        (config) => {
            const { projectRoot } = config.modRequest

            const mainDir = path.join(
                projectRoot,
                'android',
                'app',
                'src',
                'main',
                'java',
                'com',
                'chatterui',
                'nativeshell'
            )
            fs.mkdirSync(mainDir, { recursive: true })

            fs.writeFileSync(path.join(mainDir, 'NativeShellModule.kt'), NATIVE_SHELL_KT)
            fs.writeFileSync(path.join(mainDir, 'NativeShellPackage.kt'), NATIVE_SHELL_PACKAGE_KT)

            const mainApplicationPath = path.join(
                projectRoot,
                'android',
                'app',
                'src',
                'main',
                'java',
                'com',
                'chatterui'
            )

            let mainApplication = ''
            const files = fs.readdirSync(mainApplicationPath)
            for (const f of files) {
                if (f.includes('MainApplication')) {
                    mainApplication = path.join(mainApplicationPath, f)
                    break
                }
            }

            if (mainApplication) {
                let content = fs.readFileSync(mainApplication, 'utf8')
                if (!content.includes('NativeShellPackage')) {
                    content = content.replace(
                        /import\s+/,
                        'import com.chatterui.nativeshell.NativeShellPackage\nimport '
                    )
                    content = content.replace(
                        /packages\s*\+=\s*listOf\(/,
                        'packages += listOf(\n                NativeShellPackage(),\n                '
                    )
                    fs.writeFileSync(mainApplication, content)
                }
            }

            return config
        },
    ])

    return config
}

module.exports = createRunOncePlugin(withNativeShell, PLUGIN_NAME, PLUGIN_VERSION)
