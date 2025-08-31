import dotenv from "dotenv";
dotenv.config();

export interface TeraboxConfig {
    ndus: string;
}

export interface CloudPluginConfig {
    [pluginName: string]: {
        config: TeraboxConfig;
    };
}

export const cloudConfig: CloudPluginConfig = {
    terabox: {
        config: {
            ndus: process.env.NDUS ?? "YuXm_X1peHuiBnylgpqd-wcdj21H-mrrt9ZQSQaa",
        },
    },
};
