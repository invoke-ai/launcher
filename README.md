# Launcher for Invoke Community Edition

> The launcher is currently in a pre-release status. You can safely use it with your existing Invoke installation; it won't affect your images, models, or any other user data.

The launcher is a desktop application for Windows, macOS (Apple Silicon) and Linux.

It can install, update, reinstall and run Invoke Community Edition. It is self-contained, so you don't need to worry about having the right python version installed.

Download the launcher from the [releases](https://github.com/invoke-ai/launcher/releases) page.

!['Screenshot of launcher'](./assets/launcher-screenshot.png)

## FAQ

### Using the launcher to update Invoke

When installing, the launcher installs the latest stable release. We'll add support for installing pre-releases at some point.

We may or may not support installing specific versions of Invoke.

### Updating the launcher itself

> Note: This section discusses updating launcher itself, _not_ updating the Invoke application.

Currently, the launcher is not able to auto-update itself, but we are working on this now.

### 🚨 macOS: security warning / unable to run

On macOS, the launcher may require you to go to **System Settings** > **Security and Privacy** and manually allow it to run. It may tell you that it is damaged and not run at all.

This is related to Apple's strict code signing restrictions. We are getting set up with Apple to sign the launcher executable, which will fix the issue and allow the launcher to run on all Macs without any fuss.

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

### Where is the code?

The launcher codebase is in a private repo due to potentially sensitive data in the code signing workflows. We'll sort that before the stable release and move all code to this public repo.

## Technical Details

- The installer is still a python script, but we use [`Nuitka`](https://github.com/Nuitka/Nuitka/) to compile it and its dependencies into portable executables for each platform.
- We use [`uv`](https://github.com/astral-sh/uv) to create and manage the `venv`. It's much faster than `pip`.
- The GUI is an [electron](https://github.com/electron/electron) application with [React](https://github.com/facebook/react) UI.
