import fs from "node:fs/promises";
import yaml from "yaml";
import { pinyin } from "pinyin-pro"; 
import { createLogger } from "#Yunara/utils/Logger";
import { Yunzai_Path, path } from "#Yunara/utils/Path";
import { config } from "#Yunara/utils/Config";
import { findBestMatch } from "string-similarity";

const logger = createLogger("Yunara:Utils:AliasMatcher");

class AliasMatcherService {

  #isInitialized = false;
  #initializationPromise = null;

  /**
   * @private
   * @type {Map<string, string[]>}
   * @description 正向映射，键为标准角色名，值为别名数组
   */
  #aliasMap = new Map();

  /**
   * @private
   * @type {Map<string, string>}
   * @description 反向映射，键为小写别名，值为标准角色名
   */
  #reverseAliasMap = new Map();

  constructor() {
    this.#initializationPromise = this.#initialize();
  }

  async #initialize() {
    if (this.#isInitialized) return;

    logger.info("别名匹配服务开始初始化，正在加载别名数据源...");

    const exPluginsConfig = await config.get('externalPlugins');
    if (!exPluginsConfig) {
      logger.warn("未找到外部插件配置 (Ex-Plugins.yaml)，别名服务将为空。");
      this.#isInitialized = true;
      return;
    }

    const aliasSources = [];
    if (exPluginsConfig.miao?.gsAliasDir) {
      aliasSources.push({ path: path.join(Yunzai_Path, exPluginsConfig.miao.gsAliasDir, "alias.js"), type: "js" });
    }
    if (exPluginsConfig.miao?.srAliasDir) {
      aliasSources.push({ path: path.join(Yunzai_Path, exPluginsConfig.miao.srAliasDir, "alias.js"), type: "js" });
    }
    if (exPluginsConfig.zzz?.aliasDir) {
      aliasSources.push({ path: path.join(Yunzai_Path, exPluginsConfig.zzz.aliasDir, "alias.yaml"), type: "yaml" });
    }
    if (exPluginsConfig.waves?.aliasDir) {
      aliasSources.push({ path: path.join(Yunzai_Path, exPluginsConfig.waves.aliasDir, "role.yaml"), type: "yaml" });
    }

    const loadedData = await Promise.all(
      aliasSources.map(async (source) => {
        try {
          if (source.type === "js") {
            const module = await import(`file://${source.path}?t=${Date.now()}`);
            return module?.alias ?? {};
          }
          if (source.type === "yaml") {
            const content = await fs.readFile(source.path, "utf8");
            return yaml.parse(content) ?? {};
          }
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ERR_MODULE_NOT_FOUND') {
            logger.warn(`加载别名文件 ${source.path} 失败:`, error.message);
          }
          return {};
        }
        return {};
      })
    );

    this.#aliasMap.clear();
    this.#reverseAliasMap.clear();

    for (const data of loadedData) {
      for (const [canonicalName, aliases] of Object.entries(data)) {
        if (!aliases || !Array.isArray(aliases)) continue;
        const pinyinAliases = new Set();
        pinyinAliases.add(pinyin(canonicalName, { toneType: 'none', type: 'string' }));
        pinyinAliases.add(pinyin(canonicalName, { pattern: 'first', toneType: 'none', type: 'string' }));

        const allAliases = new Set([
            canonicalName,
            ...aliases,
            ...pinyinAliases
        ]);

        // 构建正向映射
        this.#aliasMap.set(canonicalName, Array.from(allAliases));

        // 构建反向映射
        for (const alias of allAliases) {
          this.#reverseAliasMap.set(String(alias).toLowerCase(), canonicalName);
        }
      }
    }

    this.#isInitialized = true;
    logger.info(`别名服务初始化完成，共加载 ${this.#reverseAliasMap.size} 个别名与拼音，对应 ${this.#aliasMap.size} 个标准名。`);
  }

  /**
   * @description 查找与输入字符串最匹配的标准角色名
   * @param {string} input 输入字符串
   * @param {object} [options={}] 匹配选项
   * @param {number} [options.threshold=0.7] 模糊匹配的相似度阈值
   * @returns {Promise<{success: boolean, name: string}>} 匹配结果
   */
  async find(input, options = {}) {
    await this.#initializationPromise;

    const { threshold = 0.7 } = options;
    const cleanedInput = String(input || "").trim();

    if (!cleanedInput) {
      return { success: false, name: cleanedInput };
    }

    const lowerInput = cleanedInput.toLowerCase();

    // 精确匹配
    if (this.#reverseAliasMap.has(lowerInput)) {
      return { success: true, name: this.#reverseAliasMap.get(lowerInput) };
    }

    // 模糊匹配
    const allKnownAliases = Array.from(this.#reverseAliasMap.keys());
    if (allKnownAliases.length === 0) {
      return { success: false, name: cleanedInput };
    }

    const bestMatch = findBestMatch(lowerInput, allKnownAliases);

    if (bestMatch.bestMatch.rating >= threshold) {
      const matchedAlias = bestMatch.bestMatch.target;
      const canonicalName = this.#reverseAliasMap.get(matchedAlias);
      return { success: true, name: canonicalName };
    }

    // 未找到
    return { success: false, name: cleanedInput };
  }
}

export const aliasMatcher = new AliasMatcherService();