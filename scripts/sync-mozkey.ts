/**
 * Synchronize MozKey settings between this repository and the live config1.db.
 *
 * Usage:
 *   bun scripts/sync-mozkey.ts                    Apply dotfiles/mozkey/config.json.
 *   bun scripts/sync-mozkey.ts export             Regenerate config.json from the live file.
 *   bun scripts/sync-mozkey.ts update-proto [tag] Refresh the vendored config.proto.
 *
 * Learning data (history.db, user_dictionary.db, zenz_feedback.tsv, ...) lives
 * beside config1.db and is deliberately outside this script's scope.
 */
import protobuf from "protobufjs";
import type { Field, Message, Type } from "protobufjs";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const mozkeyDir = join(repoRoot, "dotfiles", "mozkey");
const configJsonPath = join(mozkeyDir, "config.json");
const protoPath = join(mozkeyDir, "config.proto");

const targetDir = join(homedir(), "AppData", "LocalLow", "Mozc");
const targetPath = join(targetDir, "config1.db");
const backupPath = join(targetDir, "config1.db.bak");
const serverProcess = "mozc_server.exe";
const toolProcess = "mozc_tool.exe";

const isWindows = process.platform === "win32";

const fail = (message: string): never => {
    console.error(`error: ${message}`);
    process.exit(1);
};

interface TopLevelField {
    number: number;
    raw: Buffer;
}

/**
 * Splits a protobuf message into top-level fields without interpreting them.
 * Raw slices let us canonicalize and compare field order cheaply.
 */
const splitTopLevelFields = (buffer: Buffer): TopLevelField[] => {
    const reader = protobuf.Reader.create(buffer);
    const fields: TopLevelField[] = [];
    while (reader.pos < reader.len) {
        const start = reader.pos;
        const tag = reader.uint32();
        const number = tag >>> 3;
        if (number === 0) {
            throw new Error("invalid field number 0");
        }
        reader.skipType(tag & 7);
        fields.push({ number, raw: buffer.subarray(start, reader.pos) });
    }
    return fields;
};

const groupByNumber = (buffer: Buffer): Map<number, Buffer[]> => {
    const grouped = new Map<number, Buffer[]>();
    for (const field of splitTopLevelFields(buffer)) {
        const raws = grouped.get(field.number) ?? [];
        raws.push(field.raw);
        grouped.set(field.number, raws);
    }
    return grouped;
};

export const canonicalizeTopLevelFields = (buffer: Buffer): Buffer =>
    Buffer.concat(
        splitTopLevelFields(buffer)
            .sort((a, b) => a.number - b.number)
            .map((field) => field.raw)
    );

const changedFieldNumbers = (live: Buffer, merged: Buffer): number[] => {
    const before = groupByNumber(live);
    const after = groupByNumber(merged);
    const changed: number[] = [];
    for (const number of new Set([...before.keys(), ...after.keys()])) {
        const previous = before.get(number);
        const next = after.get(number);
        if (
            previous === undefined ||
            next === undefined ||
            previous.length !== next.length ||
            previous.some((raw, index) => Buffer.compare(raw, next[index]) !== 0)
        ) {
            changed.push(number);
        }
    }
    return changed.sort((a, b) => a - b);
};

const loadConfigType = async (): Promise<Type> => {
    if (!existsSync(protoPath)) {
        fail(`${protoPath} does not exist. Run "mise run mozkey-update-proto" first.`);
    }
    try {
        const root = await protobuf.load(protoPath);
        return root.lookupType("mozc.config.Config");
    } catch (error) {
        fail(`failed to load ${protoPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const toObjectOptions = {
    defaults: false,
    arrays: false,
    objects: false,
    enums: String,
    bytes: String,
    longs: String
} as const;

export const canonicalRoundTripMatches = (Config: Type, live: Buffer, message: Message): boolean => {
    const object = Config.toObject(message, toObjectOptions);
    const reencoded = Buffer.from(Config.encode(Config.fromObject(object)).finish());
    return Buffer.compare(canonicalizeTopLevelFields(reencoded), canonicalizeTopLevelFields(live)) === 0;
};

const unknownTopLevelFields = (Config: Type, live: Buffer): number[] => {
    const known = new Set(Object.values(Config.fieldsById).map((field) => field.id));
    return [...new Set(splitTopLevelFields(live).map((field) => field.number))].filter((number) => !known.has(number));
};

const decodeLiveConfig = (Config: Type, live: Buffer): Message => {
    let message: Message;
    try {
        message = Config.decode(live);
    } catch (error) {
        fail(`failed to decode config1.db: ${error instanceof Error ? error.message : String(error)}`);
    }
    // protobufjs drops fields the proto does not know, so an object-level
    // round-trip is the simplest way to notice a stale vendored proto.
    let matches: boolean;
    let unknown: number[];
    try {
        matches = canonicalRoundTripMatches(Config, live, message);
        unknown = unknownTopLevelFields(Config, live);
    } catch (error) {
        fail(`failed to read config1.db: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!matches) {
        const detail = unknown.length > 0 ? ` (${unknown.join(", ")})` : "";
        fail(
            `the live config1.db contains settings or values the vendored proto does not know${detail}. Run "mise run mozkey-update-proto" and try again.`
        );
    }
    return message;
};

export const mergeSettings = (Config: Type, message: Message, settings: Record<string, unknown>): Buffer => {
    try {
        const live = Config.toObject(message, toObjectOptions) as Record<string, unknown>;
        const encoded = Buffer.from(Config.encode(Config.fromObject({ ...live, ...settings })).finish());
        // The live writer's field order is not part of the contract; normalize
        // both sides so an unchanged config compares byte-equal.
        return canonicalizeTopLevelFields(encoded);
    } catch (error) {
        fail(`failed to merge config.json: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const validateScalar = (field: Field, value: unknown, path: string) => {
    const type = field.resolvedType;
    if (type instanceof protobuf.Type) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            fail(`${path} must be an object`);
        }
        validateSettingsObject(type, value as Record<string, unknown>, path);
        return;
    }
    if (type instanceof protobuf.Enum) {
        if (typeof value === "string") {
            if (!Object.hasOwn(type.values, value)) {
                fail(`${path} must be one of: ${Object.keys(type.values).join(", ")}`);
            }
        } else if (typeof value === "number") {
            if (!Object.values(type.values).includes(value)) {
                fail(
                    `${path} has an unknown enum value: ${value}. Run "mise run mozkey-update-proto" to refresh the vendored proto.`
                );
            }
        } else {
            fail(`${path} must be an enum name or number`);
        }
        return;
    }
    switch (field.type) {
        case "bool":
            if (typeof value !== "boolean") {
                fail(`${path} must be true or false`);
            }
            break;
        case "string":
            if (typeof value !== "string") {
                fail(`${path} must be a string`);
            }
            break;
        case "bytes":
            if (typeof value !== "string" || Buffer.from(value, "base64").toString("base64") !== value) {
                fail(`${path} must be a base64 string`);
            }
            break;
        case "double":
        case "float":
            if (typeof value !== "number") {
                fail(`${path} must be a number`);
            }
            break;
        case "int64":
        case "uint64":
        case "sint64":
        case "fixed64":
        case "sfixed64":
            if (typeof value === "string") {
                if (!/^-?\d+$/.test(value)) {
                    fail(`${path} must be an integer string or number`);
                }
            } else if (!Number.isInteger(value)) {
                fail(`${path} must be an integer string or number`);
            }
            break;
        case "int32":
        case "sint32":
        case "sfixed32":
            if (!Number.isInteger(value) || (value as number) < -0x80000000 || (value as number) > 0x7fffffff) {
                fail(`${path} must be a 32-bit signed integer`);
            }
            break;
        case "uint32":
        case "fixed32":
            if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff) {
                fail(`${path} must be an integer between 0 and 4294967295`);
            }
            break;
        default:
            fail(`${path} has an unsupported scalar type: ${field.type}`);
    }
};

const validateFieldValue = (field: Field, value: unknown, path: string) => {
    if (value === null) {
        fail(`${path} must not be null`);
    }
    if (field.map) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            fail(`${path} must be an object`);
        }
        for (const [key, item] of Object.entries(value)) {
            if (item === null) {
                fail(`${path}.${key} must not be null`);
            }
            validateScalar(field, item, `${path}.${key}`);
        }
        return;
    }
    if (field.repeated) {
        if (!Array.isArray(value)) {
            fail(`${path} must be an array`);
        }
        value.forEach((item, index) => {
            if (item === null) {
                fail(`${path}[${index}] must not be null`);
            }
            validateScalar(field, item, `${path}[${index}]`);
        });
        return;
    }
    validateScalar(field, value, path);
};

const validateSettingsObject = (type: Type, settings: Record<string, unknown>, path: string) => {
    for (const [key, value] of Object.entries(settings)) {
        const prefix = path === "" ? "" : `${path}.`;
        if (path === "" && key === "generalConfig") {
            fail("config.json must not contain generalConfig; MozKey manages it as machine metadata");
        }
        if (!Object.hasOwn(type.fields, key)) {
            fail(`${prefix}${key} is not a field of ${type.name}`);
        }
        validateFieldValue(type.fields[key], value, `${prefix}${key}`);
    }
};

const validateSettings = (Config: Type, settings: Record<string, unknown>) => {
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
        fail("config.json must contain an object");
    }
    validateSettingsObject(Config, settings, "");
};

const isProcessRunning = (imageName: string): boolean => {
    const result = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`, "/NH"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
        fail(`failed to inspect processes with tasklist: ${result.error?.message ?? `exit ${result.status}`}`);
    }
    return (result.stdout ?? "").toLowerCase().includes(imageName.toLowerCase());
};

const stopServer = () => {
    if (!isProcessRunning(serverProcess)) {
        return;
    }
    const result = spawnSync("taskkill", ["/IM", serverProcess, "/F"], { stdio: "ignore" });
    if (result.status !== 0 && isProcessRunning(serverProcess)) {
        fail(`failed to stop ${serverProcess}. Close it manually and run the task again.`);
    }
};

const readSettings = (): Record<string, unknown> => {
    if (!existsSync(configJsonPath)) {
        fail(`${configJsonPath} does not exist. Run "mise run mozkey-export" first.`);
    }
    try {
        return JSON.parse(readFileSync(configJsonPath, "utf8")) as Record<string, unknown>;
    } catch (error) {
        fail(`failed to parse config.json: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const applyConfig = async () => {
    if (!isWindows) {
        console.log("mozkey: skipping apply on this platform");
        return;
    }
    if (!existsSync(targetDir)) {
        fail(`${targetDir} does not exist. Install MozKey first.`);
    }

    const Config = await loadConfigType();
    const settings = readSettings();
    validateSettings(Config, settings);

    const live = existsSync(targetPath) ? readFileSync(targetPath) : Buffer.alloc(0);
    const liveMessage = decodeLiveConfig(Config, live);
    const merged = mergeSettings(Config, liveMessage, settings);

    if (Buffer.compare(merged, canonicalizeTopLevelFields(live)) === 0) {
        console.log("mozkey: config1.db is already up to date");
        return;
    }

    if (isProcessRunning(toolProcess)) {
        fail(`${toolProcess} is running. Close the MozKey settings dialog and try again.`);
    }

    // Stop the server before replacing the file so it cannot flush a stale
    // in-memory config over the new one.
    stopServer();

    const temporaryPath = `${targetPath}.tmp`;
    const backupTemporaryPath = `${backupPath}.tmp`;
    try {
        if (live.length > 0 && !existsSync(backupPath)) {
            await writeFile(backupTemporaryPath, live);
            await rename(backupTemporaryPath, backupPath);
        }
        await writeFile(temporaryPath, merged);
        await rename(temporaryPath, targetPath);
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {});
        await rm(backupTemporaryPath, { force: true }).catch(() => {});
        fail(`failed to update ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const changed = changedFieldNumbers(live, merged);
    const names = changed.map((number) => Config.fieldsById[number]?.name ?? String(number));
    console.log(`mozkey: updated ${changed.length} setting(s): ${names.join(", ")}`);

    const iconField = Config.fields.windowsImeIconStyle?.id;
    if (iconField !== undefined && changed.includes(iconField)) {
        console.log(
            "mozkey: the IME icon style is stored in config1.db but applied through the MozKey settings dialog. Open it once on this machine to update the taskbar icon."
        );
    }
};

const exportConfig = async () => {
    if (!isWindows) {
        console.log("mozkey: skipping export on this platform");
        return;
    }
    if (!existsSync(targetDir)) {
        fail(`${targetDir} does not exist. Install MozKey first.`);
    }
    if (!existsSync(targetPath)) {
        fail(`${targetPath} does not exist. Open the MozKey settings once, then try again.`);
    }

    const Config = await loadConfigType();
    const live = readFileSync(targetPath);
    if (live.length === 0) {
        fail(`${targetPath} is empty. Open the MozKey settings once, then try again.`);
    }

    const message = decodeLiveConfig(Config, live);
    const object = Config.toObject(message, toObjectOptions) as Record<string, unknown>;
    delete object.generalConfig;

    // Emit fields in schema order so repeated exports produce stable diffs.
    const ordered: Record<string, unknown> = {};
    for (const field of Object.values(Config.fieldsById).sort((a, b) => a.id - b.id)) {
        if (field.name in object) {
            ordered[field.name] = object[field.name];
        }
    }
    if (Object.keys(ordered).length === 0) {
        fail(`decoded no settings from ${targetPath}; refusing to overwrite ${configJsonPath}`);
    }
    validateSettingsObject(Config, ordered, "");

    const temporaryPath = `${configJsonPath}.tmp`;
    try {
        await writeFile(temporaryPath, `${JSON.stringify(ordered, null, 4)}\n`, "utf8");
        await rename(temporaryPath, configJsonPath);
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {});
        fail(`failed to write ${configJsonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`mozkey: exported ${Object.keys(ordered).length} settings to ${configJsonPath}`);
};

const fetchLatestTag = async (): Promise<string> => {
    const response = await fetch("https://api.github.com/repos/koyasi777/mozkey/releases/latest", {
        headers: { "User-Agent": "dotfiles-mozkey-sync" }
    });
    if (!response.ok) {
        fail(
            `failed to fetch the latest MozKey release (${response.status}). Pass a tag explicitly: mise run mozkey-update-proto v1.1.0`
        );
    }
    const release = (await response.json()) as { tag_name?: string };
    if (!release.tag_name) {
        fail("the latest MozKey release has no tag");
    }
    return release.tag_name;
};

const updateProto = async (tag?: string) => {
    const resolvedTag = tag ?? (await fetchLatestTag());
    if (!/^[A-Za-z0-9._-]+$/.test(resolvedTag)) {
        fail(`invalid tag: ${resolvedTag}`);
    }

    const response = await fetch(
        `https://raw.githubusercontent.com/koyasi777/mozkey/${resolvedTag}/src/protocol/config.proto`
    );
    if (!response.ok) {
        fail(`failed to fetch config.proto for ${resolvedTag} (${response.status})`);
    }
    const source = await response.text();

    let fieldCount: number;
    try {
        const type = protobuf.parse(source).root.lookupType("mozc.config.Config");
        fieldCount = Object.keys(type.fields).length;
    } catch (error) {
        fail(
            `failed to parse config.proto for ${resolvedTag}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    if (fieldCount === 0) {
        fail(`config.proto for ${resolvedTag} has no Config fields`);
    }

    const previousTag = existsSync(protoPath)
        ? (readFileSync(protoPath, "utf8").match(/Vendored from koyasi777\/mozkey (\S+)/)?.[1] ?? "unknown")
        : "none";
    const header = [
        `// Vendored from koyasi777/mozkey ${resolvedTag} (src/protocol/config.proto).`,
        "// Update with: mise run mozkey-update-proto [tag]",
        "",
        ""
    ].join("\n");
    const content = source.endsWith("\n") ? source : `${source}\n`;
    await writeFile(protoPath, header + content, "utf8");
    console.log(
        `mozkey: config.proto ${previousTag} -> ${resolvedTag} (${fieldCount} fields). Review the diff and commit it.`
    );
};

const main = async () => {
    const [mode = "apply", ...args] = process.argv.slice(2);
    switch (mode) {
        case "apply":
            await applyConfig();
            break;
        case "export":
            await exportConfig();
            break;
        case "update-proto":
            await updateProto(args[0]);
            break;
        default:
            fail(`unknown mode: ${mode}`);
    }
};

if (import.meta.main) {
    await main();
}
