import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '#Yunara/utils/Logger';
import { Yunara_Repos_Path } from '#Yunara/utils/Path';
import { GuGuNiuImage } from '#Yunara/models/GuGuNiu/Image';

const logger = createLogger('Yunara:GuGuNiu:DataService');

class GuGuNiuDataService_ {
    /** @private */
    #imageDataCache = null;
    #secondaryTagsCache = null;
    #initializationPromise = null;

    constructor() {
        this.#initializationPromise = this.#initialize();
    }

    async #initialize() {
        logger.info('咕咕牛数据服务开始初始化...');
        await Promise.all([
            this.#loadImageData(),
            this.#loadSecondaryTags()
        ]);
        logger.info(`咕咕牛数据服务初始化完成。图片元数据: ${this.#imageDataCache?.length ?? 0} 条，二级标签: ${this.#secondaryTagsCache?.length ?? 0} 个`);
    }

    async #loadImageData() {
        const imageDataPath = path.join(Yunara_Repos_Path, 'ImageData.json');
        try {
            const content = await fs.readFile(imageDataPath, 'utf-8');
            const rawData = JSON.parse(content);

            if (!Array.isArray(rawData)) {
                logger.error('ImageData.json 内容不是一个有效的数组，数据将为空');
                this.#imageDataCache = [];
                return;
            }

            this.#imageDataCache = rawData
                .filter(item => item && typeof item.path === 'string')
                .map(item => new GuGuNiuImage(item));

        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('未找到核心元数据文件 ImageData.json，可能是首次安装');
            } else {
                logger.error('读取或解析 ImageData.json 失败:', error);
            }
            this.#imageDataCache = [];
        }
    }

    async #loadSecondaryTags() {
        const tagsPath = path.join(Yunara_Repos_Path, 'SecondTags.json');
        try {
            const content = await fs.readFile(tagsPath, 'utf-8');
            const jsonData = JSON.parse(content);
            if (typeof jsonData === 'object' && jsonData !== null) {
                this.#secondaryTagsCache = Object.values(jsonData).flat();
            } else {
                throw new Error("JSON data is not a valid object.");
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('读取或解析 SecondTags.json 失败:', error);
            }
            this.#secondaryTagsCache = [];
        }
    }

    async getImages() {
        await this.#initializationPromise;
        return this.#imageDataCache || [];
    }

    async getSecondaryTags() {
        await this.#initializationPromise;
        return this.#secondaryTagsCache || [];
    }
    
    async refresh() {
        logger.info('强制刷新咕咕牛数据缓存...');
        this.#imageDataCache = null;
        this.#secondaryTagsCache = null;
        this.#initializationPromise = this.#initialize();
        await this.#initializationPromise;
    }
}

export const GuGuNiuDataService = new GuGuNiuDataService_();