import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

interface SkillLockEntry {
    source: string;
    sourceType: string;
    sourceUrl: string;
    ref?: string;
}

interface SkillLockFile {
    version: number;
    skills: Record<string, SkillLockEntry>;
}

const getSource = (entry: SkillLockEntry): string => {
    let source = entry.sourceUrl || entry.source;

    // well-known sourceUrl may point directly to /.well-known/...;
    // `skills add` expects the base URL.
    if (entry.sourceType === "well-known") {
        const index = source.indexOf("/.well-known/");
        if (index !== -1) {
            source = source.slice(0, index);
        }
    }

    if (entry.ref) {
        source += `@${entry.ref}`;
    }

    return source;
};

const lockPath = process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, "skills", ".skill-lock.json")
    : join(homedir(), ".agents", ".skill-lock.json");

const originalLock = await readFile(lockPath);
const lock = JSON.parse(originalLock.toString("utf8")) as SkillLockFile;

const main = async () => {
    let failed = false;

    try {
        for (const [name, entry] of Object.entries(lock.skills)) {
            const source = getSource(entry);

            console.log(`Installing ${name} from ${source}`);

            const result = spawnSync("skills", ["add", source, "--global", "--skill", name, "--yes"], {
                stdio: "inherit",
                shell: process.platform === "win32"
            });

            if (result.status !== 0) {
                console.error(`Failed to install ${name}`);
                failed = true;
            }
        }
    } finally {
        // `skills add` rewrites timestamps/hashes in the lockfile.
        // Restore the dotfiles-managed lockfile exactly as it was.
        await mkdir(dirname(lockPath), { recursive: true });
        await writeFile(lockPath, originalLock);
    }

    if (failed) {
        process.exitCode = 1;
    }
};

await main();
