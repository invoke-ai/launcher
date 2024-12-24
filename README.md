# Launcher for Invoke Community Edition

The launcher is a desktop application for Windows, macOS (Apple Silicon) and Linux.

It can install, update, reinstall and run Invoke Community Edition. It is self-contained, so you don't need to worry about having the right python version installed.

## How to get the Launcher

Click the link for your system to download the latest version of the launcher.

- [Download for Windows](https://download.invoke.ai/Invoke%20Community%20Edition.exe)
- [Download for macOS](https://download.invoke.ai/Invoke%20Community%20Edition.dmg)
- [Download for Linux](https://download.invoke.ai/Invoke%20Community%20Edition.AppImage)

You can also download all releases, including prerelease versions, from this repo's [GitHub releases](https://github.com/invoke-ai/launcher/releases).

<img width="912" alt="image" src="https://github.com/user-attachments/assets/cd676db3-b8e6-4dcc-b7a9-e442ed98a616" />

## FAQ

### Using the launcher to update Invoke

You can install the latest stable release or latest prerelease versions of Invoke using the launcher.

### Updating the launcher itself

> Note: This section discusses updating launcher itself, _not_ updating the Invoke application.

Currently, the launcher is not able to auto-update itself, but we are working on this now.

To update to the latest version, replace the old launcher executable file with the new version.

### 🚨 macOS: security warning / unable to run

On macOS, the launcher may require you to go to **System Settings** > **Security and Privacy** and manually allow it to run. It may tell you that it is damaged and not run at all.

This is related to Apple's strict code signing restrictions. We are getting set up with Apple to sign the launcher executable, which will fix the issue and allow the launcher to run on all Macs without any fuss.

Until this is resolved, you can manually flag the launcher as safe with `xattr` and it will run.:

```zsh
xattr -d 'com.apple.quarantine' /Applications/Invoke\ Community\ Edition.app
```

### Problems while installing Invoke via Launcher

If installation fails, retrying the install in Repair Mode may fix it. There's a checkbox to enable this on the Review step of the install flow.

If that doesn't fix it, [clearing the `uv` cache](https://docs.astral.sh/uv/reference/cli/#uv-cache-clean) might do the trick:

- Open and start the dev console (button at the bottom-left of the launcher).
- Run `uv cache clean`.
- Retry the installation. Enable Repair Mode for good measure.

If you are still unable to install, try installing to a different location and see if that works.

If you still have problems, ask for help on the Invoke [discord](https://discord.gg/ZmtBAhwWhy).

### Compared to the "old" install/invoke scripts

Like the install script, the launcher creates and manages a normal python virtual environment.

> We suggest leaving the `venv` alone and letting the launcher manage it, but you can interact with it like you would any `venv` if you need to.

Unlike the invoke script, the launcher provides a GUI to run the app.

### What happens to the "old" install/invoke scripts?

The "old" scripts will be phased out over time. The goal is to support 3 ways to install and run Invoke:

- Launcher
- Docker
- Manual (e.g. create a `venv` manually, install the `invokeai` package, run it as a script)

### Can I still use the "old" install/invoke scripts?

Yes, but we won't keep them updated for too much longer. Theoretically, they should continue to work for some time, even without updates.

## Technical Details

The launcher is an [electron](https://github.com/electron/electron) application with [React](https://github.com/facebook/react) UI. We bundle [`uv`](https://github.com/astral-sh/uv) with the build and then call it to install python, create the app `venv`, and run the app.

<details>

<summary>Why Electron?</summary>

There are a number of lighter-weight systems that enable cross-platform builds. [Tauri](https://tauri.app/) is probably the most popular, but there are others.

These other systems use the OS-provided engine to render their UIs. That means on Windows uses WebView2 (Chromium), macOS uses WebKit (Safari), and Linux uses WebKitGTK (basically a Linux port of Safari), and the version of the engine depends on the computer.

The result is an inconsistent user experience, and increased workload for devs to support the various rendering engines.

Electron uses the same version of Chrome for all platforms. We only need to build for one rendering engine target, and we can be far more confident in a consistent, bug-free application.

Electron uses about 10x more disk space than something like Tauri, but we're still only talking ~150MB max. You are going to install _many_ GB of models, right? The extra disk usage is a drop in the bucket and both devs and users have a much better experience.

</details>

## Contributing

Contributions are welcome!

If you want to contribute something more than a simple bug fix, please first check in with us on [discord](https://discord.gg/ZmtBAhwWhy). Ping @psychedelicious in the `dev-chat` or `installer-chat` forums.

### Dev Environment

This project uses node 22 and npm as its package manager.

- Run `npm i` to install all packages. See the next section to get `uv` set up.
- Run `npm run start` to start the launcher in dev mode.
- Run `npm run lint` to run code quality checks.

### Build

Building the launcher is very simple:

- `npm i`: install dependencies
- `npm run app:dist`: build for your system's platform

As described in the next section, you do need to manually download the `uv` binary to get a functioning build.

### Getting `uv` for local dev

The `uv` binary is required to build the project locally or run the launcher in development mode.

To fetch the `uv` binary for your operating system, use the following script. Replace PLATFORM with one of the following options based on your system:

- `linux` for Linux
- `win` for Windows
- `mac` for macOS

```sh
npm run download PLATFORM
```

This will download the appropriate `uv` binary and place it in the `assets/bin/` directory, which matches the file structure expected by the build process.

On macOS, you may need to remove the quarantine flag from the `uv` binary:

```sh
xattr -d 'com.apple.quarantine' assets/bin/uv`
```

### Code Signing

This repo does not contain the necessary secrets to do code signing. We handle that separately.

As a result, the builds from this repo may require you to manually allow them to run on Windows and macOS.

Windows will prompt you to allow the app to run, but on macOS it may refuse, saying the app is damaged. Remove the quarantine flag from the `.app` package to resolve this:

```zsh
xattr -d 'com.apple.quarantine' /Applications/Invoke\ Community\ Edition.app
```
