import dotenv from "dotenv";
dotenv.config();

export const downloadManagerConfig = {
    aria2: {
        url: process.env.ARIA2_URL ?? "",
        secret: process.env.ARIA2_SECRET ?? "",
    },
};
