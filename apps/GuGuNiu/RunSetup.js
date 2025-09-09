import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '#Yunara/utils/Logger';
import { config } from '#Yunara/utils/Config';
import { git } from '#Yunara/utils/Git';
import { data } from '#Yunara/utils/Data';
import { file } from '#Yunara/utils/File';
import { Yunara_Repos_Path, Yunzai_Path, Yunara_Res_Path } from '#Yunara/utils/Path';

const logger = createLogger('Yunara:GuGuNiu:RunSetup');

let imageDataCache = null;

async function loadImageData() {
    if (imageDataCache) return imageDataCache;
    try {
        const filePath = path.join(Yunara_Res_Path, 'Gallery', 'GuGuNiu', 'ImageData.json');
        const content = await fs.readFile(filePath, 'utf-8');
        const rawData = JSON.parse(content);

        if (!Array.isArray(rawData)) {
            logger.error("ImageData.json 内容不是一个有效的数组。");
            return [];
        }

        const validData = rawData.filter(item => {
            return item && typeof item.path === 'string' && typeof item.storagebox === 'string';
        }).map(item => ({ ...item, path: item.path.replace(/\\/g, "/") }));
        
        imageDataCache = validData;
        return validData;
    } catch (error) {
        logger.error("加载 ImageData.json 失败:", error);
        return [];
    }
}

const setupManager = {
  async runPostDownloadSetup(e) {
    logger.info("开始执行下载后设置流程...");
    await this._manageOptionalGameContentForAllRepos();
    await this._performSyncing({ isInitialSync: true });
    logger.info("下载后设置流程全部完成。");
  },

  async runPostUpdateSetup(e) {
    logger.info("开始执行更新后设置流程...");
    imageDataCache = null;
    await this._performSyncing({ isInitialSync: false });
    logger.info("更新后设置流程全部完成。");
  },

  async _performSyncing({ isInitialSync }) {
    const allImageData = await loadImageData();
    let userBans = new Set();
    
    if (isInitialSync) {
      logger.info(`已加载 ${allImageData.length} 条元数据。`);
    } else {
      userBans = new Set(await data.get('userBans', []));
      logger.info(`已加载 ${allImageData.length} 条元数据和 ${userBans.size} 条用户封禁。`);
    }

    if (allImageData.length === 0) {
        logger.warn("元数据为空，无法进行文件同步。");
        return;
    }

    const allowList = await this._buildSyncAllowList(allImageData, userBans);
    logger.info(`根据当前规则，共计算出 ${allowList.size} 张图片允许同步。`);

    await this._syncFiles(allowList, isInitialSync);
  },

  async _buildSyncAllowList(allImageData, userBans) {
    const settings = await config.get('guguniu.settings') || {};
    const allowMap = new Map();
    for (const item of allImageData) {
      const relativePath = item.path;
      if (userBans.has(relativePath)) continue;
      if (item.attributes?.isBan === true) continue;
      const pflLevel = settings.PurificationLevel || 0;
      if (pflLevel > 0) {
        const isRx18 = item.attributes?.isRx18 === true;
        const isPx18 = item.attributes?.isPx18 === true;
        if (pflLevel === 1 && isRx18) continue;
        if (pflLevel === 2 && (isRx18 || isPx18)) continue;
      }
      if (settings.Filter?.Ai === false && item.attributes?.isAiImage === true) continue;
      if (settings.Filter?.EasterEgg === false && item.attributes?.isEasterEgg === true) continue;
      if (settings.Filter?.Layout === false && item.attributes?.layout === "fullscreen") continue;
      allowMap.set(relativePath, item);
    }
    return allowMap;
  },

  async _syncFiles(allowMap, isInitialSync) {
    const MANIFEST_KEY = 'runtime.syncManifest';
    const previousManifest = await data.get(MANIFEST_KEY, []);
    const newManifest = [];
    const externalPlugins = await config.get('externalPlugins') || {};
    const targetPaths = {
      gs: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      sr: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      zzz: externalPlugins.zzz?.syncTarget ? path.join(Yunzai_Path, externalPlugins.zzz.syncTarget) : null,
      waves: externalPlugins.waves?.syncTarget ? path.join(Yunzai_Path, externalPlugins.waves.syncTarget) : null,
    };

    let cleanedCount = 0;
    for (const oldItem of previousManifest) {
      if (!allowMap.has(oldItem.path)) {
        const targetDir = targetPaths[oldItem.gameKey];
        if (targetDir) {
          const destPath = path.join(targetDir, oldItem.characterName, path.basename(oldItem.path));
          await file.safeDelete(destPath);
          cleanedCount++;
        }
      }
    }
    logger.info(`文件清理完成，移除了 ${cleanedCount} 个过时文件。`);

    let syncedCount = 0;
    const previousManifestSet = new Set(previousManifest.map(item => item.path));
    for (const [relativePath, item] of allowMap.entries()) {
      const gameKey = item.sourceGallery ? item.sourceGallery.split('-')[0] : 'unknown';
      const targetDir = targetPaths[gameKey];
      
      if (targetDir) {
        const sourcePath = path.join(Yunara_Repos_Path, item.storagebox, relativePath);
        const destPath = path.join(targetDir, item.characterName, path.basename(relativePath));
        
        try {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(sourcePath, destPath);
          newManifest.push({ path: relativePath, gameKey: gameKey, characterName: item.characterName });
          if (isInitialSync || !previousManifestSet.has(relativePath)) {
            syncedCount++;
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            logger.error(`同步文件 ${relativePath} 失败 (源: ${sourcePath}):`, error);
          }
        }
      }
    }
    if (isInitialSync) {
        logger.info(`首次文件同步完成，共同步了 ${syncedCount} 个新文件。`);
    } else {
        logger.info(`文件同步完成，新增或更新了 ${syncedCount} 个文件。`);
    }
    await data.set(MANIFEST_KEY, newManifest);
  },

  async _manageOptionalGameContentForAllRepos() {
    const galleryConfig = await config.get('guguniu.gallery');
    if (!galleryConfig || !Array.isArray(galleryConfig.repositories)) return;
    for (const repoConfig of galleryConfig.repositories) {
      if (repoConfig.containsOptionalContent) {
        const repoName = path.basename(new URL(repoConfig.url).pathname, '.git');
        const localPath = path.join(Yunara_Repos_Path, repoName);
        if (await git.isRepoDownloaded(localPath)) {
          await this._manageOptionalGameContent(localPath, 'zzz', 'zzz-character');
          await this._manageOptionalGameContent(localPath, 'waves', 'waves-character');
        }
      }
    }
  },

  async _manageOptionalGameContent(repositoryPath, gameKey, gameFolderName) {
    const pluginPath = path.join(Yunzai_Path, 'plugins', `${gameKey}-plugin`);
    const pluginInstalled = await file.exists(pluginPath);
    if (pluginInstalled) {
      logger.info(`检测到 ${gameKey}-plugin 已安装，将为仓库 ${path.basename(repositoryPath)} 添加跟踪规则: ${gameFolderName}`);
      await git.manageExcludeRules(repositoryPath, { remove: [gameFolderName] });
    } else {
      logger.info(`检测到 ${gameKey}-plugin 未安装，将为仓库 ${path.basename(repositoryPath)} 添加忽略规则: ${gameFolderName}`);
      await git.manageExcludeRules(repositoryPath, { add: [gameFolderName] });
    }
  }
};

export { setupManager };