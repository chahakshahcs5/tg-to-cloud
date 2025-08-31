import fs from "fs";
import path from "path";
import YAML from "yaml";

import input from "@inquirer/input";
import { FileMeta, FileMetaInfoThumbs } from "terabox-api";
import { filesize } from "filesize";

export interface FsItem {
    is_dir: boolean;
    path: string;
}

export interface MetaInfo {
    path: string;
    name: string;
    size: string;
    isdir: number;
    dlink: string | undefined;
    thumbs: FileMetaInfoThumbs | undefined;
    docpreview: string | undefined;
    lodocpreview: string | undefined;
    file_key: string | undefined;
}

export const delay = async (ms: number): Promise<void> => {
    if (ms < 1) {
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
};

export const selectLocalPath = async (inputPath?: string): Promise<string> => {
    let answer = inputPath || "";
    if (typeof answer !== "string" || answer === "") {
        answer = await input({ message: "Local Path:" });
    }
    answer = answer.replace(/^"(.*)"$/, "$1");
    try {
        if (fs.statSync(answer).isDirectory()) {
            return path.resolve(answer);
        } else {
            return await selectLocalPath();
        }
    } catch (error) {
        return await selectLocalPath();
    }
};

export const selectRemotePath = async (
    remotePath?: string
): Promise<string> => {
    try {
        remotePath = await cleanupRemotePath(remotePath);
        return remotePath;
    } catch (e) {
        return selectRemotePath(remotePath);
    }
};

export const cleanupRemotePath = async (
    remotePath?: string
): Promise<string> => {
    if (typeof remotePath !== "string" || remotePath === "") {
        remotePath = await input({ message: "Remote Path:" });
        if (remotePath === "") {
            return await cleanupRemotePath(remotePath);
        }
    }
    if (remotePath!.match(/^root/)) {
        remotePath = remotePath!.replace(/^root/, "");
    }
    remotePath =
        "/" +
        remotePath!
            .split("/")
            .map((v) => cleanupName(v))
            .join("/");
    remotePath = remotePath.replace(/\/+/g, "/");
    if (remotePath !== "/" && remotePath.match(/\/$/)) {
        remotePath = remotePath.replace(/\/$/, "");
    }
    return remotePath;
};

const cleanupName = (fsName: string): string => {
    const fixingChar = "";
    const illegalRe = /[\/\?<>\\:\*\|":]/g;
    const controlRe = /[\x00-\x1f\x80-\x9f]/g;
    const reservedRe = /^\.+$/;
    const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
    const windowsTrailingRe = /[\. ]+$/;
    fsName = fsName
        .replace(illegalRe, fixingChar)
        .replace(controlRe, fixingChar)
        .replace(reservedRe, fixingChar)
        .replace(windowsReservedRe, fixingChar)
        .replace(windowsTrailingRe, fixingChar);
    return fsName;
};

export const scanLocalPath = (localPath: string): FsItem[] => {
    try {
        const blackListRegex =
            /(^\..*|\.!qB|\.part|\.tbtemp|\.temp|\.downloading)$/i;
        const fsList = fs
            .readdirSync(localPath, { withFileTypes: true })
            .filter((item) => !item.name.match(blackListRegex))
            .map((item) => ({
                is_dir: item.isDirectory(),
                path: path.resolve(item.parentPath, item.name).replace(/\\+/g, "/"),
            }))
            .sort((a, b) => {
                if (a.is_dir && !b.is_dir) return 1;
                if (!a.is_dir && b.is_dir) return -1;
                return 0;
            });
        return fsList;
    } catch (error) {
        return [];
    }
};

export const extractMetaInfo = (fileMeta: FileMeta): MetaInfo[] => {
    const fileMetaInfo: MetaInfo[] = [];
    for (const f of fileMeta.info) {
        fileMetaInfo.push({
            path: f.path,
            name: f.server_filename,
            size: filesize(f.size, {
                standard: "iec",
                round: 3,
                pad: true,
            }),
            isdir: f.isdir,
            dlink: f.dlink,
            thumbs: f.thumbs,
            docpreview: f.docpreview,
            lodocpreview: f.lodocpreview,
            file_key: f.file_key,
        });
    }
    return fileMetaInfo;
};

export const stripPath = (rPath: string) => {
    return rPath.replace(new RegExp("^/"), "");
};

export const loadYaml = (file: string) => {
    try {
        const data = fs.readFileSync(file, "utf8");
        const obj = YAML.parse(data);
        if (Object.prototype.toString.call(obj) === "[object Object]") {
            return obj;
        } else {
            throw new Error("Bad YAML!");
        }
    } catch (e) {
        return { error: e };
    }
};

export const loadTBTemp = (filePath: string, remoteDir: string) => {
    const tbtempfile = filePath + ".tbtemp";
    const data = loadYaml(tbtempfile);
    delete data.error;

    if (typeof data.upload_id !== "string") {
        data.upload_id = "";
    }
    if (typeof data.remote_dir !== "string" || data.remote_dir == "") {
        data.remote_dir = remoteDir;
    }
    if (typeof data.file !== "string" || data.file == "") {
        data.file = path.basename(filePath);
    }
    if (!Number.isSafeInteger(data.size) || data.size < 0) {
        data.size = fs.statSync(filePath).size;
    }

    return { tbtempfile, data };
};

export const saveYaml = (file: string, data: any) => {
    fs.writeFileSync(file, YAML.stringify(data, { lineWidth: 0 }));
};
