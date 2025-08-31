import dotenv from "dotenv";
dotenv.config();

export const envConfig = {
    apiId: parseInt(process.env.API_ID || "", 10),
    apiHash: process.env.API_HASH || "",
    phoneNumber: process.env.PHONE_NUMBER || "",
    allowedChannels: (process.env.ALLOWED_CHANNELS || "").split(","),
    allowedFileTypes: (process.env.ALLOWED_FILE_TYPES || "").split(","),
    //   sessionString: new StringSession(process.env.SESSION_STRING || ""),
    maxRetries: parseInt(process.env.MAX_RETRIES || "", 10),
    cloudPlugin: process.env.CLOUD_PLUGIN || "",
    mongoUri: process.env.MONGODB_URI || "",
};
