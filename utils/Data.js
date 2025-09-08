import path from "node:path";
import fs from "node:fs/promises";
import lodash from "lodash";
import { createLogger } from "#Yunara/utils/Logger";
import { Yunara_Data_Path } from "#Yunara/utils/Path";

const logger = createLogger("Yunara:Utils:Data");

const JSON_FILES = {
  runtime: path.join(Yunara_Data_Path, "yunara_runtime.json"),
  userBans: path.join(Yunara_Data_Path, "guguniu_bans.json"),
  imageData: path.join(Yunara_Data_Path, "GuGuNiu", "ImageData.json"),
};

class DataService {
  #cache = {};
  #locks = new Map();

  constructor() {
    Object.keys(JSON_FILES).forEach(key => this.#loadJsonFile(key));
  }

  async #loadJsonFile(fileKey) {
    if (!this.#locks.has(fileKey)) {
      this.#locks.set(fileKey, (async () => {
        try {
          const filePath = JSON_FILES[fileKey];
          const fileContent = await fs.readFile(filePath, "utf8");
          this.#cache[fileKey] = JSON.parse(fileContent);
        } catch (error) {
          if (error.code === 'ENOENT') {
            logger.warn(`数据文件 ${JSON_FILES[fileKey]} 不存在，将初始化为空值。`);
            this.#cache[fileKey] = (fileKey === 'userBans' || fileKey === 'imageData') ? [] : {};
          } else {
            logger.error(`读取或解析数据文件 ${JSON_FILES[fileKey]} 失败：`, error);
            this.#cache[fileKey] = (fileKey === 'userBans' || fileKey === 'imageData') ? [] : {};
          }
        } finally {
          this.#locks.delete(fileKey);
        }
      })());
    }
    return this.#locks.get(fileKey);
  }

  async get(key, defaultValue = undefined) {
    const [fileKey, ...pathParts] = key.split('.');
    if (!JSON_FILES[fileKey]) {
      throw new Error(`未知的数据文件域: ${fileKey}`);
    }
    if (this.#locks.has(fileKey)) {
      await this.#locks.get(fileKey);
    }
    if (pathParts.length === 0) {
      return lodash.cloneDeep(this.#cache[fileKey] ?? defaultValue);
    }
    return lodash.get(this.#cache[fileKey], pathParts.join('.'), defaultValue);
  }

  async set(key, value) {
    const [fileKey, ...pathParts] = key.split('.');
    if (!JSON_FILES[fileKey]) {
      throw new Error(`未知的数据文件域: ${fileKey}`);
    }
    if (this.#locks.has(fileKey)) {
      await this.#locks.get(fileKey);
    }
    if (pathParts.length === 0) {
        this.#cache[fileKey] = value;
    } else {
        if (typeof this.#cache[fileKey] !== 'object' || this.#cache[fileKey] === null) {
            this.#cache[fileKey] = {};
        }
        lodash.set(this.#cache[fileKey], pathParts.join('.'), value);
    }
    this.#saveJsonFile(fileKey);
    return true;
  }

  async #saveJsonFile(fileKey) {
    const filePath = JSON_FILES[fileKey];
    const dataToSave = this.#cache[fileKey] || ((fileKey === 'userBans' || fileKey === 'imageData') ? [] : {});
    try {
      const jsonString = JSON.stringify(dataToSave, null, 2);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, jsonString, "utf8");
    } catch (error) {
      logger.error(`写入数据文件 ${filePath} 失败:`, error);
    }
  }

  async getImageData(forceReload = false) {
    const fileKey = 'imageData';
    if (forceReload || !this.#cache[fileKey]) {
      await this.#loadJsonFile(fileKey);
    }
    
    const rawData = this.#cache[fileKey] || [];
    if (!Array.isArray(rawData)) {
        logger.error("ImageData.json 内容不是一个有效的数组，将返回空数组。");
        return [];
    }

    const validData = rawData.filter(item => {
        const isBasicValid = item && typeof item.path === 'string' && item.path.trim() !== "" &&
          typeof item.characterName === 'string' && item.characterName.trim() !== "" &&
          typeof item.attributes === 'object' &&
          typeof item.storagebox === 'string' && item.storagebox.trim() !== "";
        if (!isBasicValid) return false;
        
        const pathRegex = /^[a-z]+-character\/[^/]+\/[^/]+\.webp$/i;
        const normalizedPath = item.path.replace(/\\/g, "/");
        return pathRegex.test(normalizedPath);
    }).map(item => ({ ...item, path: item.path.replace(/\\/g, "/") }));

    if (rawData.length > 0 && validData.length === 0) {
        logger.warn("ImageData.json 中似乎没有符合当前格式要求的数据。");
    }

    this.#cache[fileKey] = validData;
    return validData;
  }
}

export const data = new DataService();