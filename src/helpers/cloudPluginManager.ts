import { cloudConfig } from "../config/cloudConfig";
import { join } from "path";
import { ICloudPlugin } from "../interface/cloudPlugin";
import { envConfig } from "../config/envConfig";

export class CloudPluginManager {
    private static instance: CloudPluginManager;
    private plugin: ICloudPlugin | undefined;
    public static pluginProvider: string;

    private constructor() { }

    private initializePlugin(): void {
        const pluginPath = join(__dirname, `../plugins/${envConfig.cloudPlugin}`);
        const PluginClass = require(pluginPath).default;
        CloudPluginManager.pluginProvider = envConfig.cloudPlugin;
        if (typeof PluginClass.getInstance === "function") {
            this.plugin = PluginClass.getInstance(
                cloudConfig[envConfig.cloudPlugin ?? ""].config
            );
        } else {
            throw new Error(
                `Plugin at ${pluginPath} does not have a static getInstance() method`
            );
        }
    }

    public static getInstance(): CloudPluginManager {
        if (!CloudPluginManager.instance) {
            CloudPluginManager.instance = new CloudPluginManager();
            this.instance.initializePlugin();
        }
        return CloudPluginManager.instance;
    }

    public getPlugin(): ICloudPlugin | undefined {
        return this.plugin;
    }

    async uploadFile(localFilePath: string, filePath: string): Promise<string> {
        if (!this.plugin) {
            throw new Error("Cloud plugin not initialized.");
        }
        // Assuming the upload method in ICloudPlugin returns a string
        return this.plugin.upload(localFilePath, filePath);
    }
}
