/**
 * Synchronize Sine mods and their settings between the dotfiles repository
 * and the default Zen Browser profile.
 *
 * Usage:
 *   bun scripts/sync-zen.ts          Apply: wire mods.json/user.js symlinks and install missing mods.
 *   bun scripts/sync-zen.ts export   Regenerate the repository-managed user.js from prefs.js.
 *
 * Sine itself is never installed or updated here; when it is missing the run
 * fails so that `mise bootstrap` stops before touching the profile.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const repoZenDir = join(import.meta.dir, "..", "dotfiles", "zen");
const modsJsonSource = join(repoZenDir, "mods.json");
const userJsSource = join(repoZenDir, "user.js");

interface Ini {
    [section: string]: Record<string, string>;
}

interface ModEntry {
    id: string;
    homepage?: string;
}

interface GitHubRepo {
    author: string;
    name: string;
    /** Branch name or 40-character commit hash. Empty for bare homepages. */
    ref: string;
    folder: string;
}

/** Reads a Firefox-style INI file (`[Section]` lines with `Key=Value` pairs). */
const parseIni = (text: string): Ini => {
    const ini: Ini = {};
    let section = "";
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith("[") && line.endsWith("]")) {
            section = line.slice(1, -1);
            ini[section] ??= {};
        } else if (section && line) {
            const separator = line.indexOf("=");
            if (separator > 0) {
                ini[section][line.slice(0, separator)] = line.slice(separator + 1);
            }
        }
    }
    return ini;
};

/**
 * Resolves the profile directory Zen starts with by default, or `null` when
 * Zen (and thus any profile) is not installed on this machine. The resolution
 * happens on every run without caching; `installs.ini` holds the default per
 * installed application and `profiles.ini` entries with `Default=1` are the
 * fallback.
 */
const defaultProfileDir = async (): Promise<string | null> => {
    const home = homedir();
    const root =
        process.platform === "win32"
            ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "zen")
            : process.platform === "darwin"
              ? join(home, "Library", "Application Support", "zen")
              : join(home, ".zen");

    if (!existsSync(root)) {
        return null;
    }

    let profilePath = "";
    const installsIni = join(root, "installs.ini");
    if (existsSync(installsIni)) {
        const defaults = [...new Set(Object.values(await readIni(installsIni)).map((section) => section["Default"]))];
        if (defaults.length === 1) {
            profilePath = defaults[0];
        }
    }

    if (!profilePath) {
        const profilesIni = join(root, "profiles.ini");
        if (existsSync(profilesIni)) {
            profilePath =
                Object.values(await readIni(profilesIni)).find((section) => section["Default"] === "1")?.["Path"] ?? "";
        }
    }

    if (!profilePath) {
        throw new Error(`Failed to resolve the default Zen profile from installs.ini/profiles.ini in ${root}.`);
    }

    return isAbsolute(profilePath) ? profilePath : join(root, profilePath);
};

const readIni = async (path: string): Promise<Ini> => parseIni(await readFile(path, "utf8"));

/** Fails the run when Sine's engine is not present in the profile. */
const assertSineInstalled = (profileDir: string): void => {
    const marker = join(profileDir, "chrome", "JS", "sine.sys.mjs");
    if (!existsSync(marker)) {
        throw new Error(
            `Sine is not installed in the profile (${profileDir}). ` +
                "Install Sine with its official installer first, see https://github.com/sineorg/docs. " +
                "This script never installs Sine itself."
        );
    }
};

/**
 * Parses GitHub mod locations the same way Sine does, so any `homepage` in
 * mods.json maps to the right repository snapshot. Supported forms:
 *   https://github.com/owner/repo[/tree/<branch>[/<folder>]]
 *   https://github.com/owner/repo/commit/<sha>[/<folder>]
 *   owner/repo[/tree/<branch>[/<folder>]] with or without the domain
 */
const parseGitHubUrl = (homepage: string): GitHubRepo => {
    const stripped = homepage
        .trim()
        .replace(/^https?:\/\//u, "")
        .replace(/\/+$/u, "");
    const match = stripped.match(
        /^(?:github\.com\/)?([\w\-.]+)\/([\w\-.]+)(?:\/(?:tree|commit)\/([\w\-.]+)(?:\/(.*))?)?$/u
    );
    if (!match) {
        throw new Error(`Unsupported GitHub mod location: "${homepage}"`);
    }

    return {
        author: match[1],
        name: match[2],
        ref: match[3] ?? "",
        folder: match[4] ?? ""
    };
};

const isCommitHash = (ref: string): boolean => /^[0-9a-f]{40}$/iu.test(ref);

/** Queries the repository's default branch for bare homepages without a `tree/` segment. */
const defaultBranch = async (repo: GitHubRepo): Promise<string> => {
    const response = await fetch(`https://api.github.com/repos/${repo.author}/${repo.name}`);
    if (!response.ok) {
        throw new Error(`Failed to resolve the default branch of ${repo.author}/${repo.name}: ${response.status}`);
    }
    const repository = (await response.json()) as { default_branch: string };
    return repository.default_branch;
};

/**
 * Downloads and extracts a repository snapshot into a temporary directory and
 * returns its path. The caller is responsible for cleaning the directory up.
 */
const downloadRepoSnapshot = async (repo: GitHubRepo, id: string): Promise<string> => {
    const revision = repo.ref === "" ? await defaultBranch(repo) : repo.ref;
    const archiveRef = isCommitHash(revision) ? revision : `refs/heads/${revision}`;
    const response = await fetch(`https://codeload.github.com/${repo.author}/${repo.name}/zip/${archiveRef}`);
    if (!response.ok) {
        throw new Error(`Failed to download ${repo.author}/${repo.name} (${revision}): ${response.status}`);
    }

    const workDir = join(tmpdir(), `sine-${id}`);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    writeFileSync(join(workDir, "snapshot.zip"), Buffer.from(await response.arrayBuffer()));

    // Windows ships bsdtar in System32 which reads zip archives; Git's GNU tar
    // cannot, so never rely on PATH resolution there.
    const untar =
        process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    const extraction = spawnSync(untar, ["-xf", join(workDir, "snapshot.zip"), "-C", workDir], {
        stdio: "ignore"
    });
    if (extraction.status !== 0) {
        throw new Error(`Failed to extract the mod archive of ${id}.`);
    }
    return workDir;
};

const installMods = async (profileDir: string): Promise<boolean> => {
    const mods = JSON.parse(await readFile(modsJsonSource, "utf8")) as Record<string, ModEntry>;
    const modsDir = join(profileDir, "chrome", "sine-mods");
    await mkdir(modsDir, { recursive: true });

    let failed = false;
    for (const [id, entry] of Object.entries(mods)) {
        const modDir = join(modsDir, id);
        if (existsSync(modDir)) {
            console.log(`    ${id}: already installed, skipping.`);
            continue;
        }
        if (!entry.homepage) {
            console.error(`    ${id}: no homepage in mods.json, cannot install.`);
            failed = true;
            continue;
        }

        try {
            const repo = parseGitHubUrl(entry.homepage);
            const workDir = await downloadRepoSnapshot(repo, id);

            let contentRoot = (await readdir(workDir))
                .map((name) => join(workDir, name))
                .filter((path) => lstatSync(path).isDirectory())[0];
            if (repo.folder !== "") {
                contentRoot = join(contentRoot, ...repo.folder.split("/"));
            }
            if (!existsSync(contentRoot)) {
                throw new Error(`the archive does not contain the "${repo.folder}" folder.`);
            }

            await cp(contentRoot, modDir, { recursive: true });
            await rm(workDir, { recursive: true, force: true });
            console.log(`    ${id}: installed from ${repo.author}/${repo.name}.`);
        } catch (error) {
            // A half-copied folder would make the next run believe the mod is
            // installed; remove it so the retry is a clean one.
            await rm(modDir, { recursive: true, force: true });
            const message = error instanceof Error ? error.message : String(error);
            console.error(`    ${id}: ${message}`);
            failed = true;
        }
    }

    return failed;
};

/**
 * Creates `target` as a symlink pointing at `source`, silently replacing
 * whatever regular file sits at `target`.
 */
const linkFile = async (source: string, target: string): Promise<void> => {
    await mkdir(dirname(target), { recursive: true });
    await rm(target, { force: true, recursive: true });

    try {
        await symlink(source, target, "file");
    } catch (error) {
        // mklink is a cmd.exe builtin, so it must run through cmd. Use the
        // absolute ComSpec path instead of PATH lookup, and
        // windowsVerbatimArguments to prevent spawn from re-quoting the
        // argument, which would break cmd's /s parsing.
        if (process.platform !== "win32") {
            throw error;
        }
        const mklink = spawnSync(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", `mklink "${target}" "${source}"`],
            { stdio: "ignore", windowsVerbatimArguments: true }
        );
        if (mklink.status !== 0) {
            throw error;
        }
    }
};

const isLinkedTo = (source: string, target: string): boolean => {
    try {
        return realpathSync(target) === realpathSync(source);
    } catch {
        return false;
    }
};

/**
 * Wires profile files to the repository copies so that edits flow both ways:
 *
 * - `chrome/sine-mods/mods.json` makes Sine's metadata edits (install, toggle,
 *   auto-update) show up in the repository automatically. Sine writes mods.json
 *   through IOUtils, which opens and rewrites the existing file, so the
 *   symlink survives every write.
 * - `user.js` applies the exported preferences on every browser startup.
 */
const wireProfileLinks = async (profileDir: string): Promise<void> => {
    const links: Array<{ source: string; target: string }> = [
        { source: modsJsonSource, target: join(profileDir, "chrome", "sine-mods", "mods.json") }
    ];

    if (existsSync(userJsSource)) {
        links.push({ source: userJsSource, target: join(profileDir, "user.js") });
    } else {
        console.warn(`    user.js is missing in dotfiles; run "sync-zen export" once.`);
    }

    for (const { source, target } of links) {
        if (isLinkedTo(source, target)) {
            continue;
        }
        await linkFile(resolve(source), target);
        console.log(`    linked ${target} -> ${source}`);
    }
};

/**
 * Extracts Sine-related user preferences from prefs.js into the
 * repository-managed user.js. Mod preference names are stored as plain prefs
 * whose prefix is up to each mod: the generic "mod." prefix (older mods), the
 * mod's own id (e.g. "zia."), or the "uc." prefix used by userChrome-style
 * mods (e.g. blended-addressbar). Firefox rewrites prefs.js itself about
 * 500 ms after each change, so the browser may stay open during the export.
 *
 * Prefs a mod stores under unrelated prefixes are intentionally not exported:
 * Zia's AI provider settings (`extensions.downloads.*`) hold API keys, and
 * exporting those into the repository would leak secrets.
 */
const exportPrefs = async (profileDir: string): Promise<void> => {
    const prefsJs = await readFile(join(profileDir, "prefs.js"), "utf8");
    const prefixes = ["mod.", "sine.", "uc.", ...(await modIds()).map((id) => `${id}.`)];

    // Prefs that must not leave this machine: `pending-restart` is transient
    // browser state, and `zia.siteColors` maps visited domains to colors,
    // which amounts to browsing history.
    const excludedPrefs = new Set(["sine.engine.pending-restart", "zia.siteColors"]);

    const prefName = (line: string): string | null => {
        const match = line.match(/^user_pref\("([^"]+)"/u);
        return match ? match[1] : null;
    };

    const lines = prefsJs
        .split(/\r?\n/)
        .filter((line) => {
            const name = prefName(line);
            return name !== null
                && prefixes.some((prefix) => name.startsWith(prefix))
                && !excludedPrefs.has(name);
        })
        .sort();

    const content =
        "// Generated by dotfiles scripts/sync-zen.ts export. Do not edit directly.\n" +
        '// Applies Sine ("sine.*") and Sine mod ("mod.*", "uc.*", "<mod id>.*") preferences on browser startup.\n' +
        lines.join("\n") +
        "\n";
    await writeFile(userJsSource, content, "utf8");
};

/** Returns the mod ids tracked in the repository mods.json. */
const modIds = async (): Promise<string[]> =>
    Object.keys(JSON.parse(await readFile(modsJsonSource, "utf8")) as Record<string, ModEntry>);

const main = async (): Promise<void> => {
    const mode = process.argv[2] ?? "apply";
    if (mode !== "apply" && mode !== "export") {
        throw new Error(`Unknown mode "${mode}". Use "export" or pass no arguments.`);
    }
    const profileDir = await defaultProfileDir();
    if (!profileDir) {
        // Zen (and Sine with it) is not on this machine, e.g. inside WSL;
        // there is nothing to synchronize, but bootstrap should not stop.
        console.log("    Zen profile directory not found; skipping.");
        return;
    }

    if (mode === "export") {
        await exportPrefs(profileDir);
        console.log(`Exported mod preferences to ${userJsSource}.`);
        console.log("Review the diff and commit it manually.");
        return;
    }

    assertSineInstalled(profileDir);
    await wireProfileLinks(profileDir);
    const hasFailures = await installMods(profileDir);
    if (hasFailures) {
        throw new Error("One or more mods failed to install; see the errors above.");
    }
    console.log("Sine sync complete. Restart Zen to load newly installed mods.");
};

await main();
