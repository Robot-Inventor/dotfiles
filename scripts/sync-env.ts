import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

const NAME = "DO_NOT_TRACK";
const VALUE = "1";

const run = (command: string, args: string[], input?: string) => {
    execFileSync(command, args, {
        input,
        stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"]
    });
};

/** Run a command whose output is noise, such as reg.exe. */
const runQuiet = (command: string, args: string[]) => {
    execFileSync(command, args, { stdio: "ignore" });
};

/** Run a command whose failure is expected, such as unloading a job that is not loaded. */
const tryRun = (command: string, args: string[]) => {
    try {
        runQuiet(command, args);
    } catch {
        // Nothing to clean up.
    }
};

switch (process.platform) {
    case "win32": {
        // WSL sessions do not reliably run the PAM login that reads
        // /etc/environment, so the value crosses over through WSLENV.
        const wslEnv = (process.env.WSLENV ?? "").split(":").filter(Boolean);

        if (!wslEnv.some((entry) => entry.split("/")[0] === NAME)) {
            runQuiet("setx", ["WSLENV", [...wslEnv, NAME].join(":")]);
        }

        // setx, unlike a bare registry write, broadcasts WM_SETTINGCHANGE, so
        // programs started afterwards see the value without signing out.
        runQuiet("setx", [NAME, VALUE]);
        break;
    }

    case "linux": {
        // PAM reads /etc/environment for every login session, including SSH.
        const path = "/etc/environment";
        const content = existsSync(path) ? readFileSync(path, "utf8") : "";

        if (new RegExp(`^${NAME}=`, "m").test(content)) break;

        // A file without a trailing newline would swallow the new entry.
        const separator = content && !content.endsWith("\n") ? "\n" : "";
        run("sudo", ["tee", "-a", path], `${separator}${NAME}=${VALUE}\n`);
        break;
    }

    case "darwin": {
        // launchctl gives the variable to GUI apps as well as shells.
        run("launchctl", ["setenv", NAME, VALUE]);

        // The setting dies with the reboot, so a LaunchAgent re-applies it at
        // every login.
        const uid = process.getuid?.();
        const plistPath = `${homedir()}/Library/LaunchAgents/local.donottrack.plist`;
        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.donottrack</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>${NAME}</string>
    <string>${VALUE}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;

        if (!existsSync(plistPath) || readFileSync(plistPath, "utf8") !== plist) {
            mkdirSync(dirname(plistPath), { recursive: true });
            writeFileSync(plistPath, plist);
            tryRun("launchctl", ["bootout", `gui/${uid}`, plistPath]);
            // A headless or SSH session has no gui domain to bootstrap into; the
            // plist still applies from the next graphical login.
            tryRun("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
        }

        break;
    }

    default:
        throw new Error(`Unsupported platform: ${process.platform}`);
}
