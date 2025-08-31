export interface ICloudPlugin {
    upload(localFilePath: string, filePath: string): Promise<string>;
}
