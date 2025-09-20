# Telegram Save to Cloud

This project is a TypeScript-based tool and python server for uploading files to various cloud storage providers, with a plugin-based architecture that makes it easy to extend.

## Features

-   **Cloud Agnostic:** Easily switch between different cloud storage providers by changing the configuration.
-   **Plugin-Based Architecture:** Add support for new cloud providers by creating a new plugin.
-   **Environment-Based Configuration:** Uses a `.env` file for easy configuration.

## Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/chahakshahcs5/tg-to-cloud.git
    cd tg-to-cloud
    ```
2.  Install the dependencies:
    ```bash
    npm install
    ```
3.  Build the project:
    ```bash
    npm run build
    ```
4. Python Setup:
    ```bash
    python3 -m venv .venv
    source venv/bin/activatebasher 
    python3 -m pip install -r requirements.txt
    npm install
    source /home/user/tg-to-cloud/.venv/bin/activate && python3 main.py
    ```

## Configuration

1.  Create a `.env` file in the root of the project.
2.  Add the following environment variables:

    ```env
    API_ID=
    API_HASH=
    SESSION_STRING= Session string 
    NDUS=  Terabox Nuds - Gte it from Cookies of terabox website
    ARIA2_URL="http://localhost:8080/jsonrpc"
    ARIA2_SECRET="secret"
    CLOUD_PLUGIN="terabox"
    MONGODB_URI=mongodb://localhost:27017
    MONGO_DB=tg-to-cloud
    SAVE_DIR=Downloads
    BASE_PATH=~/tg-to-cloud-python
    MAX_FILE_SIZE=104857600 # 100 MB
    MAX_CONCURRENCY=5
    EXPORT_LIMIT=100
    ```

3.  Configure the cloud provider-specific settings in `src/config/cloudConfig.ts`.

## Supported Cloud Providers

-   **Terabox:** The initial implementation includes a plugin for Terabox.

## How to Add a New Cloud Provider

1.  Create a new plugin in the `src/plugins` directory.
2.  Implement the `ICloudPlugin` interface.
3.  Add the configuration for the new plugin in `src/config/cloudConfig.ts`.
4.  Update the `CLOUD_PLUGIN` environment variable in your `.env` file to the name of your new plugin.

## Project Structure

```
.
├── src
│   ├── plugins
│   │   └── terabox
│   │       └── index.ts
│   ├── config
│   │   ├── cloudConfig.ts
│   │   └── ...
│   ├── helpers
│   │   └── cloudPluginManager.ts
│   └── index.ts
├── package.json
└── tsconfig.json
main.py
config.py
```

## Dependencies

-   [@inquirer/input](https://www.npmjs.com/package/@inquirer/input): ^4.2.1
-   [dateformat](https://www.npmjs.com/package/dateformat): ^5.0.3
-   [dotenv](https://www.npmjs.com/package/dotenv): ^17.2.1
-   [filesize](https://www.npmjs.com/package/filesize): ^11.0.2
-   [terabox-api](https://www.npmjs.com/package/terabox-api): ^2.4.4
-   [tough-cookie](https://www.npmjs.com/package/tough-cookie): ^5.1.2
-   [undici](https://www.npmjs.com/package/undici): ^7.12.0
-   [yaml](https://www.npmjs.com/package/yaml): ^2.8.0
-   [yargs](https://www.npmjs.com/package/yargs): ^18.0.0

## Dev Dependencies

-   [@types/dateformat](https://www.npmjs.com/package/@types/dateformat): ^5.0.3
-   [@types/node](https://www.npmjs.com/package/@types/node): ^24.1.0
-   [ts-node](https://www.npmjs.com/package/ts-node): ^10.0.0
-   [ts-node-dev](https://www.npmjs.com/package/ts-node-dev): ^2.0.0
-   [typescript](https://www.npmjs.com/package/typescript): ^5.0.0

## Python Dependencies

-   [telethon](https://pypi.org/project/Telethon/)==1.40.0
-   [python-dotenv](https://pypi.org/project/python-dotenv/)==1.1.1
-   [fastapi](https://pypi.org/project/fastapi/)==0.116.1
-   [uvicorn](https://pypi.org/project/uvicorn/)==0.35.0
-   [motor](https://pypi.org/project/motor/)==3.7.1
-   [psutil](https://pypi.org/project/psutil/)==7.1.0

## Python Server

-   Serevr is running on Port 8000
-   EndPoint - GET - "/export/{dialog_title}", dialog_title is dialog (channel or group or chat) name, Query Params - exts -> Can be file extension like .png, .pdf 
-   Example "/export/test?exts=.png,.mp4"

