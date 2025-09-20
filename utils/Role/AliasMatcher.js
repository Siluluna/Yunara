import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { pinyin } from "pinyin-pro";
import { createLogger } from "#Yunara/utils/logger";
import { Yunzai_Path, Yunara_Repos_Path } from "#Yunara/utils/path"; 
import { config } from "#Yunara/utils/config";
import { NiuRepository } from "#Yunara/models/niu/repository"; 

const logger = createLogger("Yunara:Utils:AliasMatcher");

/**
 * @private
 * @description 计算两个字符串之间的莱文斯坦距离
 * @param {string} s1 字符串1
 * @param {string} s2 字符串2
 * @returns {number} 编辑距离
 */
function _levenshtein(s1, s2) {
    if (s1 === s2) return 0;
    const l1 = s1.length, l2 = s2.length;
    if (l1 === 0) return l2;
    if (l2 === 0) return l1;
    let v0 = new Array(l2 + 1);
    let v1 = new Array(l2 + 1);
    for (let i = 0; i <= l2; i++) v0[i] = i;
    for (let i = 0; i < l1; i++) {
        v1[0] = i + 1;
        for (let j = 0; j < l2; j++) {
            v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + (s1[i] === s2[j] ? 0 : 1));
        }
        v0 = v1.slice();
    }
    return v0[l2];
}

class AliasMatcherService {
    #isInitialized = false;
    #initializationPromise = null;

    /**
     * @private
     * @type {Map<string, {names: Set<string>, pinyins: Set<string>}>}
     * @description 优化的查找表，键为标准角色名
     */
    #lookupTable = new Map();
    
    /**
     * @private
     * @type {Map<string, string>}
     * @description 反向映射，键为小写别名/拼音，值为标准角色名
     */
    #reverseAliasMap = new Map();

    constructor() {
        this.#initializationPromise = this.#initialize();
    }

    async #initialize() {
        if (this.#isInitialized) return;

        logger.info("多维别名匹配器开始初始化...");

        const exPluginsConfig = await config.get('externalPlugins');
        if (!exPluginsConfig) {
            logger.warn("未找到外部插件配置 (ex_plugins.yaml)，别名服务将为空。");
        }

        const aliasSources = [];
        if (exPluginsConfig?.miao?.gsAliasDir) {
            aliasSources.push({ path: path.join(Yunzai_Path, exPluginsConfig.miao.gsAliasDir), type: "miao" });
        }
        if (exPluginsConfig?.miao?.srAliasDir) {
            aliasSources.push({ path: path.join(Yunzai_Path, exPluginsConfig.miao.srAliasDir), type: "miao" });
        }
        if (exPluginsConfig?.zzz?.aliasDir) {
            aliasSources.push({ path: path.join(Yunzai_Path, exPluginsConfig.zzz.aliasDir, "alias.yaml"), type: "yaml" });
        }
        if (exPluginsConfig?.waves?.aliasDir) {
            aliasSources.push({ path: path.join(Yunzai_Path, exPluginsConfig.waves.aliasDir, "role.yaml"), type: "yaml" });
        }

        const combinedAliases = {};

        const loadPromises = aliasSources.map(source => this.#loadAliasSource(source, combinedAliases));
        
        const repoScanPromise = this.#scanRepoCharacterFolders(combinedAliases);
        await Promise.all([...loadPromises, repoScanPromise]);

        this.#buildLookupTable(combinedAliases);
        this.#isInitialized = true;
        logger.info(`多维别名匹配器初始化完成，共加载 ${this.#reverseAliasMap.size} 个别名与拼音，对应 ${this.#lookupTable.size} 个标准名。`);
    }

    async #loadAliasSource(source, targetObject) {
        try {
            let data = {};
            if (source.type === "miao") {
                const files = await fs.readdir(source.path);
                const aliasFile = files.find(f => f === 'alias.js');
                if (aliasFile) {
                    const module = await import(`file://${path.join(source.path, aliasFile)}?t=${Date.now()}`);
                    data = module?.alias ?? {};
                }
            } else if (source.type === "yaml") {
                const content = await fs.readFile(source.path, "utf8");
                data = yaml.parse(content) ?? {};
            }
            // 合并别名，确保不会覆盖已有的
            for (const [mainName, aliases] of Object.entries(data)) {
                if (!targetObject[mainName]) {
                    targetObject[mainName] = [];
                }
                const existingAliases = new Set(targetObject[mainName]);
                const newAliases = Array.isArray(aliases) ? aliases : String(aliases).split(',');
                newAliases.forEach(alias => existingAliases.add(alias));
                targetObject[mainName] = Array.from(existingAliases);
            }
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ERR_MODULE_NOT_FOUND') {
                logger.warn(`加载别名文件 ${source.path} 失败:`, error.message);
            }
        }
    }

    /**
     * @private
     * @description 扫描所有已下载的咕咕牛仓库，将角色文件夹名作为别名
     */
    async #scanRepoCharacterFolders(targetObject) {
        const downloadedRepos = await NiuRepository.getDownloaded();
        for (const repo of downloadedRepos) {
            try {
                const gameFolders = await fs.readdir(repo.localPath, { withFileTypes: true });
                for (const gameFolder of gameFolders) {
                    if (gameFolder.isDirectory()) {
                        const gameFolderPath = path.join(repo.localPath, gameFolder.name);
                        const characterFolders = await fs.readdir(gameFolderPath, { withFileTypes: true });
                        for (const charFolder of characterFolders) {
                            if (charFolder.isDirectory()) {
                                const charName = charFolder.name;
                                // 如果这个角色名还不存在，就添加它，自己是自己的别名
                                if (!targetObject[charName]) {
                                    targetObject[charName] = [charName];
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                logger.warn(`扫描仓库 [${repo.name}] 的角色文件夹失败:`, error.message);
            }
        }
    }
    
    /**
     * @private
     * @description 构建查找表，包含小写、全拼、首字母拼音
     */
    #buildLookupTable(aliasData) {
        for (const [mainName, aliases] of Object.entries(aliasData)) {
            const validAliases = Array.isArray(aliases) ? aliases : String(aliases).split(',');
            
            const allNames = new Set([mainName, ...validAliases].map(n => String(n).trim()).filter(Boolean));
            
            const pinyinNames = new Set();
            for (const name of allNames) {
                pinyinNames.add(pinyin(name, { toneType: 'none' }).replace(/\s/g, ''));
                pinyinNames.add(pinyin(name, { pattern: 'first', toneType: 'none' }).replace(/\s/g, ''));
            }

            const lowerCaseNames = new Set(Array.from(allNames).map(n => n.toLowerCase()));

            this.#lookupTable.set(mainName, {
                names: lowerCaseNames,
                pinyins: pinyinNames,
            });

            for (const alias of lowerCaseNames) {
                this.#reverseAliasMap.set(alias, mainName);
            }
            for (const pinyinAlias of pinyinNames) {
                this.#reverseAliasMap.set(pinyinAlias, mainName);
            }
        }
    }

    /**
     * @public
     * @description 查找与输入字符串最匹配的标准角色名
     * @param {string} input 输入字符串
     * @returns {Promise<{success: boolean, name: string, matchType: 'exact'|'pinyin'|'fuzzy'|'none', score: number}>} 匹配结果
     */
    async find(input) {
        await this.#initializationPromise;

        const cleanedInput = String(input || "").trim();
        if (!cleanedInput) {
            return { success: false, name: cleanedInput, matchType: 'none', score: 0 };
        }
        const lowerInput = cleanedInput.toLowerCase();

        // 阶段一：精确匹配
        if (this.#reverseAliasMap.has(lowerInput)) {
            return { success: true, name: this.#reverseAliasMap.get(lowerInput), matchType: 'exact', score: 100 };
        }

        // 阶段二：拼音匹配
        const inputPinyin = pinyin(lowerInput, { toneType: 'none' }).replace(/\s/g, '');
        if (this.#reverseAliasMap.has(inputPinyin)) {
            return { success: true, name: this.#reverseAliasMap.get(inputPinyin), matchType: 'pinyin', score: 95 };
        }
        const inputFirstPinyin = pinyin(lowerInput, { pattern: 'first', toneType: 'none' }).replace(/\s/g, '');
        if (this.#reverseAliasMap.has(inputFirstPinyin)) {
            return { success: true, name: this.#reverseAliasMap.get(inputFirstPinyin), matchType: 'pinyin', score: 90 };
        }

        // 阶段三：模糊匹配融合加权评分
        let bestMatch = { name: cleanedInput, score: -Infinity };
        const threshold = await config.get('yunara.aliasMatcherThreshold', 65);

        for (const [mainName, data] of this.#lookupTable.entries()) {
            for (const term of data.names) {
                const distance = _levenshtein(lowerInput, term);
                const maxLen = Math.max(lowerInput.length, term.length);
                let score = 0;

                if (term.startsWith(lowerInput)) {
                    score = 85 - (term.length - lowerInput.length) * 5 - distance * 10;
                } else {
                    const similarity = maxLen === 0 ? 1 : (maxLen - distance) / maxLen;
                    score = similarity * 100;
                    if (distance === 1) {
                        score += 25; // 对编辑距离为1的情况进行额外加分
                    }
                }

                if (score > bestMatch.score) {
                    bestMatch = { name: mainName, score };
                }
            }
        }

        if (bestMatch.score >= threshold) {
            return { success: true, name: bestMatch.name, matchType: 'fuzzy', score: bestMatch.score };
        }

        return { success: false, name: cleanedInput, matchType: 'none', score: 0 };
    }
}

export const aliasMatcher = new AliasMatcherService();