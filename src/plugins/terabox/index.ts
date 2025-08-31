import TeraBoxApp, { FileMeta, FileMetaInfo, RemoteDirectoryList } from "terabox-api";

import {
    getChunkSize,
    hashFile,
    unwrapErrorMessage,
    uploadChunks,
} from "terabox-api/helper";
import fs from "fs";
import path from "path";
import { filesize } from "filesize";
import dateFormat from "dateformat";
import { request } from "undici";
import crypto from "crypto";
import { TeraboxConfig } from "../../config/cloudConfig";
import { ICloudPlugin } from "../../interface/cloudPlugin";
import {
    extractMetaInfo,
    loadYaml,
    MetaInfo,
    saveYaml,
    stripPath,
} from "./module-helper";
import { downloadManagerConfig } from "../../config/downloadManagerConfig";

export interface IFmRename {
    path: string;
    newName: string;
}

export interface IFmCopyParams {
    path: string;
    dest: string;
    newName: string;
}

export interface IFmMoveParams {
    path: string;
    dest: string;
    newName: string;
}

function wrapWithLoginCheck<T extends object>(
    instance: T,
    methodToRun: () => Promise<void>
): T {
    return new Proxy(instance, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === "function" && prop !== "checkLogin") {
                return async function (...args: any[]) {
                    await methodToRun.call(target); // call checkLogin before every method
                    return value.apply(target, args);
                };
            }

            return value;
        },
    });
}

class Terabox implements ICloudPlugin {
    private static instance: Terabox;
    private config: TeraboxConfig;
    private app: TeraBoxApp;
    private appHostUpdated: boolean;

    private constructor(config: TeraboxConfig) {
        this.config = config;
        this.app = new TeraBoxApp(this.config.ndus);
        this.appHostUpdated = false;
    }

    public static getInstance(config: TeraboxConfig): Terabox {
        if (!Terabox.instance) {
            const raw = new Terabox(config);
            // Wrap with login check
            Terabox.instance = wrapWithLoginCheck(raw, raw.checkLogin.bind(raw));
        }
        return Terabox.instance;
    }

    public async upload(localFilePath: string, filePath: string): Promise<any> {
        return await this.uploadFile(localFilePath, filePath);
    }

    // Authentication

    private async preLogin(email: string) {
        try {
            const preLoginData = await this.app.passportPreLogin(email);
            if (preLoginData.code === 0) {
                return preLoginData.data;
            }
            throw new Error("PreLogin: Bad Response");
        } catch (error) {
            console.log(error);
        }
    }

    public async login(email: string, password: string): Promise<any> {
        try {
            const preLoginData = await this.preLogin(email);
            if (preLoginData) {
                const authData = await this.app.passportLogin(
                    preLoginData,
                    email,
                    password
                );
                console.log(authData); // TODO: Check the data and add proper type
                if (authData.code === 0) {
                    return authData.data;
                }
                throw new Error("Login: Bad Response");
            } else {
                throw new Error("PreLogin: Bad Response");
            }
        } catch (error) {
            console.log(error);
        }
    }

    // This is require to update terabox app host
    private async checkLogin() {
        try {
            if (!this.appHostUpdated) {
                const acc_check = await this.app.checkLogin();
                if (acc_check?.errno != 0) {
                    throw new Error('[ERROR] "ndus" cookie is BAD!');
                }
                this.appHostUpdated = true;
            }
        } catch (error) {
            console.log(error);
        }
    }

    // Account Helper

    private async getAccountInfoHelper() {
        const [acc_info, membership, acc_quota] = await Promise.all([
            this.app.passportGetInfo(),
            this.app.userMembership(),
            this.app.getQuota(),
        ]);

        const spaceUsed = filesize(acc_quota.used, {
            standard: "iec",
            round: 3,
            pad: true,
        });
        const spaceTotal = filesize(acc_quota.total, {
            standard: "iec",
            round: 3,
            pad: true,
        });
        const spaceFree = filesize(acc_quota.available, {
            standard: "iec",
            round: 3,
            pad: true,
        });
        let vip_end_date: any = null;
        let vip_left_time: any = null;

        if (this.app.params.is_vip) {
            const vip_end_time = membership.data.member_info.vip_end_time * 1000;
            vip_left_time = Math.floor(
                membership.data.member_info.vip_left_time / (24 * 60 * 60)
            );

            vip_end_date = dateFormat(vip_end_time, "UTC:yyyy-mm-dd");
        }

        return {
            user: { ...acc_info.data },
            acc_quota: {
                expire: acc_quota.expire,
                free: acc_quota.free,
                total: acc_quota.total,
                used: acc_quota.used,
                available: acc_quota.available,
            },
            spaceText: {
                spaceFree,
                spaceTotal,
                spaceUsed,
            },
            vip_end_date: vip_end_date || null,
            vip_left_time: vip_left_time || null,
            membership: {
                ...membership.data,
            },
        };
    }

    public async getAccountInfo(showCoins: boolean) {
        const accountInfo = await this.getAccountInfoHelper();

        if (showCoins) {
            const coins = await this.app.getCoinsCount();
            return { ...accountInfo, coins: { ...coins.data } };
        }

        return accountInfo;
    }

    // File Metadata

    public async getFileMetaInfo(filePath: string): Promise<MetaInfo[]> {
        const fileList = await this.getFilesPath(filePath);
        const getMeta = await this.app.getFileMeta(fileList);
        return extractMetaInfo(getMeta);
    }

    // This includes directories and subdirectories
    public async getAllFilesMetaInfo(filePath: string): Promise<MetaInfo[]> {
        const fileList = await this.getAllFilesPath(filePath);
        const getMeta = await this.app.getFileMeta(fileList);
        return extractMetaInfo(getMeta);
    }

    public async getFilesPath(filePath: string): Promise<string[]> {
        const pathData = await this.app.getRemoteDir(filePath);
        if (pathData.errno !== 0) {
            console.error(`Failed to Get Data ERROR #${pathData.errno}`);
            return [];
        }

        if (pathData.list.length == 0) {
            // It's a file
            return [filePath];
        } else {
            // It's a directory

            const fileList: string[] = [];
            for (const f of pathData.list) {
                fileList.push(f.path);
            }
            return fileList;
        }
    }

    // This includes directories and subdirectories
    public async getAllFilesPath(filePath: string): Promise<string[]> {
        const pathData = await this.app.getRemoteDir(filePath);
        if (pathData.errno !== 0) {
            throw new Error(`Failed to Get Data ERROR #${pathData.errno}`);
        }

        let sRoot = "";
        if (pathData.list.length == 0) {
            // It's a file

            sRoot = filePath.split("/").slice(0, -1).join("/");
            return [filePath];
        } else {
            // It's a directory

            if (sRoot == "") {
                sRoot = pathData.list[0].path.split("/").slice(0, -1).join("/") || "/";
            }
            const fileList: string[] = [];
            for (const f of pathData.list) {
                if (f.isdir == 1) {
                    const subList = await this.getFilesPath(f.path);
                    fileList.push(...subList);
                } else {
                    fileList.push(f.path);
                }
            }
            return fileList;
        }
    }

    // File Manager

    public async fmDelete(remotePath: string[]) {
        const data = await this.app.filemanager("delete", [remotePath]);
        if (data.errno === 0) {
            return { success: true };
        }
        return { success: false };
    }

    public async fmRename(params: IFmRename[]) {
        const data = await this.app.filemanager(
            "rename",
            params.map((param) => ({
                ...param,
                newname: param.newName,
            }))
        );
        console.log(data);
        if (data.errno === 0) {
            return { success: true };
        }
        return { success: false };
    }

    public async fmCopy(params: IFmCopyParams[]) {
        const data = await this.app.filemanager(
            "copy",
            params.map((param) => ({
                ...param,
                newname: param.newName,
            }))
        );
        if (data.errno === 0) {
            return { success: true };
        }
        return { success: false };
    }

    public async fmMove(params: IFmMoveParams[]) {
        const data = await this.app.filemanager(
            "move",
            params.map((param) => ({
                ...param,
                newname: param.newName,
            }))
        );
        if (data.errno === 0) {
            return { success: true };
        }
        return { success: false };
    }

    // Download Manager

    public async downloadFiles(filePath: string) {
        const fileList = await this.getFilesPath(filePath);
        const getMeta = await this.app.getFileMeta(fileList);
        await this.downloadHelper(getMeta);
    }

    // This includes directories and subdirectories
    public async downloadAllFiles(filePath: string) {
        const fileList = await this.getAllFilesPath(filePath);
        const getMeta = await this.app.getFileMeta(fileList);
        await this.downloadHelper(getMeta);
    }

    public async downloadHelper(fileMeta: FileMeta) {
        // aria2c -x 16 -s 10 -j 4 -k 1M --enable-rpc --rpc-allow-origin-all=true --dir=/home/user/tg-forward-tera/downloads --rpc-secret=sceret

        // aria2c -x 16 -s 10 -j 4 -k 1M --enable-rpc --rpc-allow-origin-all=true --dir=D:/Downloads --rpc-secret=YOUR_ARIA2_RPC_SECRET
        // https://aria2.github.io/manual/en/html/aria2c.html#aria2.addUri
        // The commented-out line is an example of how you would typically start an
        // aria2c daemon from the command line with RPC enabled. This script,
        // however, is designed to *control* an already-running aria2c daemon using
        // its JSON-RPC interface.
        //
        // Let's break down the example command:
        //
        // `aria2c`: The command to execute the aria2 download utility.
        // `-x 16`: Sets the maximum number of connections to a server for a download. Higher values can speed up downloads.
        // `-s 10`: Sets the maximum number of parallel downloads.
        // `-j 4`: Sets the maximum number of active downloads.
        // `-k 1M`: Sets the minimum chunk size for downloads. This helps with handling large files efficiently.
        // `--enable-rpc`: Enables the JSON-RPC interface, allowing external programs (like this script) to control aria2.
        // `--rpc-allow-origin-all=true`: Allows RPC requests from any origin. *Note: In a production environment, you should restrict origins for security.*
        // `--dir=D:/Downloads`: Sets the default download directory.
        // `--rpc-secret=YOUR_ARIA2_RPC_SECRET`: Sets a secret token for authenticating RPC requests. This is crucial for security.

        const jsonReq: any = {
            jsonrpc: "2.0",
            id: "DOWNLOAD_ID",
            method: "aria2.addUri",
            params: ["token:" + downloadManagerConfig.aria2.secret],
        };

        const rpcReq: any = [];
        const files = fileMeta.info.filter((file: FileMetaInfo) => file.isdir !== 1);
        for (const [i, f] of files.entries()) {
            if (f.isdir === 0) {
                rpcReq.push(structuredClone(jsonReq));
            }

            const folderName = stripPath(f.path.split("/").slice(0, -1).join("/"));

            rpcReq[i].id = crypto.randomUUID();
            rpcReq[i].params.push([f.dlink]);
            rpcReq[i].params.push({
                "user-agent": this.app.params.ua,
                out: (folderName ? folderName + "/" : "") + f.server_filename,
            });
        }

        try {
            const rpcUrl = new URL(downloadManagerConfig.aria2.url);
            const req = await request(rpcUrl, {
                method: "POST",
                body: JSON.stringify(rpcReq),
            });
            console.log("ADDING...");
            console.log("CODE:", req.statusCode);
            // console.log(await req.body.json());
        } catch (error) {
            console.error(error);
        }
    }

    // Upload Manager

    public async createDirectory(remoteDir: string) {
        try {
            const reqRemoteDir = await this.app.getRemoteDir(remoteDir);
            if (reqRemoteDir.errno == 0) {
                console.log("Remote Dir Already Exists:", remoteDir);
            } else {
                const remoteDirData = await this.app.createDir(remoteDir);
                console.log("Remote Dir Created:", remoteDir);
                if (remoteDirData.errno != 0) {
                    throw new Error("Bad Response");
                }
            }
        } catch (error: any) {
            console.error("[ERROR] Failed to create remote dir:", remoteDir);
            console.error(error);
            return;
        }
    }

    public async uploadFile(
        filePath: string,
        remotePath: string
    ): Promise<string | undefined> {
        try {
            const isTBHash = filePath.match(/\.tbhash$/) ? true : false;

            const tbHashFile = filePath + ".tbhash";
            const tbtempfile = isTBHash ? filePath : filePath + ".tbtemp";

            const data = loadYaml(tbtempfile);
            delete data.error;

            if (!data.upload_id || typeof data.upload_id != "string") {
                data.upload_id = "";
            }
            if (!data.remote_dir || typeof data.remote_dir != "string") {
                data.remote_dir = remotePath;
            }
            if (!data.file || typeof data.file != "string") {
                data.file = path.basename(filePath);
                if (isTBHash) {
                    data.file = data.file.replace(/\.tbhash$/, "");
                }
            }
            if (!isTBHash && (!data.size || isNaN(data.size))) {
                data.size = fs.statSync(filePath).size;
            }

            if (data.size < 1) return;

            if (data.size > getChunkSize(data.size, this.app.params.is_vip) * 1024)
                return;

            let remoteFsList: Partial<RemoteDirectoryList>[] = [];

            const reqRemoteDir = await this.app.getRemoteDir(remotePath);
            if (reqRemoteDir.errno == 0) {
                remoteFsList = reqRemoteDir.list;
            }

            const findRemote = remoteFsList.find((f) => {
                return f.server_filename == data.file;
            });

            if (findRemote) return;

            if (!isTBHash && !data.hash && fs.existsSync(tbHashFile)) {
                const tbHashData = loadYaml(tbHashFile);
                data.hash = tbHashData.hash;
                saveYaml(tbtempfile, data);
            }

            if (!isTBHash && !data.hash) {
                data.hash = await hashFile(filePath);
                saveYaml(tbtempfile, data);
            }

            try {
                const preCreateData = await this.app.precreateFile(data);
                if (preCreateData.errno == 0) {
                    // save new upload id
                    data.upload_id = preCreateData.uploadid;
                    saveYaml(tbtempfile, data);
                    // fill uploaded data temporary
                    data.uploaded = new Array(data.hash.chunks.length).fill(true);
                    for (const uBlock of preCreateData.block_list) {
                        data.uploaded[uBlock] = false;
                    }
                } else {
                    throw new Error("Bad Response");
                }
            } catch (error) {
                console.error(
                    "[ERROR] Can't precreate file:",
                    unwrapErrorMessage(error)
                );
                return;
            }

            await this.app.getUploadHost(); // Need to update upload host
            // const maxTasks = data.size <= 4 * Math.pow(1024, 3) ? 10 : 5;
            const upload_status = await uploadChunks(this.app, data, filePath);
            delete data.uploaded;

            if (upload_status.ok) {
                try {
                    const upload_info = await this.app.createFile(data);
                    if (upload_info.errno == 0) {
                        const remoteFile = upload_info.path.split("/").at(-1);

                        remoteFsList.push({ server_filename: remoteFile, size: data.size });

                        const rmeta = await this.app.getFileMeta([upload_info.path]);
                        const fmeta = rmeta.info[0];

                        // build weak etag
                        const chunksJSON = JSON.stringify(data.hash.chunks);
                        const chunksETAG = crypto
                            .createHash("md5")
                            .update(chunksJSON)
                            .digest("hex");
                        const weakEtag =
                            data.hash.chunks.length > 1 ? chunksETAG : data.hash.file;

                        // hash check
                        const hashMatch = weakEtag === fmeta.md5;

                        // size check
                        const sizeMatch = data.size === fmeta.size;

                        // skip deleting tbtemp file if mismatch...
                        if (!sizeMatch || !hashMatch) {
                            console.error(":: File is BAD!");
                            return;
                        }

                        try {
                            fs.unlinkSync(tbtempfile);
                        } catch (error) {
                            console.error(
                                "[ERROR] Can't remove tbtemp file:",
                                unwrapErrorMessage(error)
                            );
                        }
                        return remotePath;
                    }
                    throw new Error("Bad Response");
                } catch (error) {
                    console.error(
                        "[ERROR] Can't save file to remote:",
                        unwrapErrorMessage(error)
                    );
                    throw new Error("Error uploading file");
                }
            }
        } catch (error) {
            console.log(error);
            throw new Error("Error uploading file");
        }
    }
}

export default Terabox;
