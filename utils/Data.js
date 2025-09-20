import path from "node:path";
import fs from "node:fs/promises";
import lodash from "lodash";
import { createLogger } from "#Yunara/utils/logger";
import { Yunara_Data_Path, Yunara_Repos_Path } from "#Yunara/utils/path";

const logger = createLogger("Yunara:Utils:Data");

const JSON_FILES = {
  runtime: path.join(Yunara_Data_Path, "yunara_runtime.json"),
  niu_userBans: path.join(Yunara_Data_Path, "niu", "niu_bans.json"),
  niu_imagedata: path.join(Yunara_Repos_Path, "ImageData.json"),
  niu_secondary_tags: path.join(Yunara_Repos_Path, "SecondTags.json"),
};

class DataService {
  #cache = {};
  #locks = new Map();

  constructor() {}

  async #loadJsonFile(fileKey) {
    if (!this.#locks.has(fileKey)) {
      this.#locks.set(fileKey, (async () => {
        try {
          const filePath = JSON_FILES[fileKey];
          const fileContent = await fs.readFile(filePath, "utf8");
          this.#cache[fileKey] = JSON.parse(fileContent);
        } catch (error) {
          if (error.code === 'ENOENT') {
            const emptyValue = (fileKey === 'niu_userBans' || fileKey === 'niu_secondary_tags') ? [] : {};
            this.#cache[fileKey] = emptyValue;
            logger.debug(`数据文件 ${JSON_FILES[fileKey]} 不存在，将初始化为默认值。`);
          } else {
            logger.error(`读取或解析数据文件 ${JSON_FILES[fileKey]} 失败：`, error);
            const emptyValue = (fileKey === 'niu_userBans' || fileKey === 'niu_secondary_tags') ? [] : {};
            this.#cache[fileKey] = emptyValue;
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
    if (this.#cache[fileKey] === undefined) {
      await this.#loadJsonFile(fileKey);
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
    if (this.#cache[fileKey] === undefined) {
      await this.get(fileKey);
    }
    if (pathParts.length === 0) {
        this.#cache[fileKey] = value;
    } else {
        if (typeof this.#cache[fileKey] !== 'object' || this.#cache[fileKey] === null) {
            this.#cache[fileKey] = {};
        }
        lodash.set(this.#cache[fileKey], pathParts.join('.'), value);
    }
    await this.#saveJsonFile(fileKey);
    return true;
  }

  async #saveJsonFile(fileKey) {
    const filePath = JSON_FILES[fileKey];
    const dataToSave = this.#cache[fileKey] || ((fileKey === 'niu_userBans' || fileKey === 'niu_secondary_tags') ? [] : {});
    try {
      const jsonString = JSON.stringify(dataToSave, null, 2);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, jsonString, "utf8");
    } catch (error) {
      logger.error(`写入数据文件 ${filePath} 失败:`, error);
    }
  }
}

export const data = new DataService();