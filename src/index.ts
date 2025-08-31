import { unlink } from "fs/promises";
import dotenv from "dotenv";
import { CloudPluginManager } from "./helpers/cloudPluginManager";

dotenv.config();

const uploadFile = async () => {
    console.warn = () => { }; // disable all warnings

    const args = process.argv.slice(2);
    const localFilePath = args[0]
    const remoteFilePath = args[1]
    const pluginManager = CloudPluginManager.getInstance();
    await pluginManager.uploadFile(localFilePath, remoteFilePath);
    await unlink(localFilePath);
}

uploadFile()

