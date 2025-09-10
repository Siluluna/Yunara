import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '#Yunara/utils/Logger';
import { config } from '#Yunara/utils/Config';
import { git } from '#Yunara/utils/Git';
import { data } from '#Yunara/utils/Data';
import { file } from '#Yunara/utils/File';
import { Yunara_Repos_Path, Yunzai_Path } from '#Yunara/utils/Path';
import { GuGuNiuDataService } from '#Yunara/utils/GuGuNiu/DataService';
import { GuGuNiuRepository } from '#Yunara/models/GuGuNiu/Repository';

const logger = createLogger('Yunara:GuGuNiu:RunSetup');

const setupManager = {
  async runPostDownloadSetup(e) {
    logger.info("开始执行下载后设置流程...");
    await this._manageOptionalGameContentForAllRepos();
    await this._performSyncing({ isInitialSync: true });
    logger.info("下载后设置流程全部完成。");
  },

  async runPostUpdateSetup(e) {
    logger.info("开始执行更新后设置流程...");
    await GuGuNiuDataService.refresh();
    await this._performSyncing({ isInitialSync: false });
    logger.info("更新后设置流程全部完成。");
  },

  async _cleanAllGuGuNiuImages(targetPaths) {
    logger.info("开始执行图库文件清理...");
    let cleanedCount = 0;
    
    const cleanPromises = Object.values(targetPaths).filter(Boolean).map(async (targetDir) => {
      try {
        await fs.access(targetDir);
        const characterFolders = await fs.readdir(targetDir, { withFileTypes: true });
        
        for (const charFolder of characterFolders) {
          if (charFolder.isDirectory()) {
            const charPath = path.join(targetDir, charFolder.name);
            const files = await fs.readdir(charPath);
            for (const fileName of files) {
              if (fileName.toLowerCase().includes('gu') && fileName.toLowerCase().endsWith('.webp')) {
                await file.safeDelete(path.join(charPath, fileName));
                cleanedCount++;
              }
            }
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn(`清理目录 ${targetDir} 时出错:`, error.message);
        }
      }
    });

    await Promise.all(cleanPromises);
    logger.info(`文件清理完成，共移除了 ${cleanedCount} 个旧图库文件`);
  },

  async _performSyncing({ isInitialSync }) {
    const allImages = await GuGuNiuDataService.getImages();
    const userBans = new Set(await data.get('userBans', []));
    const settings = await config.get('guguniu.settings') || {};

    logger.info(`已加载 ${allImages.length} 条元数据和 ${userBans.size} 条用户封禁`);

    if (allImages.length === 0) {
        logger.warn("元数据为空，无法进行文件同步");
        return;
    }

    const allowedImages = allImages.filter(image => image.isAllowed(settings, userBans));
    const allowMap = new Map(allowedImages.map(image => [image.path, image]));
    logger.info(`根据当前规则，共计算出 ${allowMap.size} 张图片允许同步`);

    await this._syncFilesWithClean(allowMap);
  },

  async _syncFilesWithClean(allowMap) {
    const externalPlugins = await config.get('exPlugins') || {};
    const targetPaths = {
      gs: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      sr: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      zzz: externalPlugins.zzz?.syncTarget ? path.join(Yunzai_Path, externalPlugins.zzz.syncTarget) : null,
      waves: externalPlugins.waves?.syncTarget ? path.join(Yunzai_Path, externalPlugins.waves.syncTarget) : null,
    };

    await this._cleanAllGuGuNiuImages(targetPaths);

    logger.info(`开始全量同步 ${allowMap.size} 张图片...`);
    let syncedCount = 0;
    
    for (const [relativePath, image] of allowMap.entries()) {
      const gameKey = image.sourceGallery ? image.sourceGallery.split('-')[0] : 'unknown';
      const targetDir = targetPaths[gameKey];
      
      if (targetDir) {
        const sourcePath = path.join(Yunara_Repos_Path, image.storagebox, relativePath);
        const destPath = path.join(targetDir, image.characterName, path.basename(relativePath));
        
        try {
          await fs.access(sourcePath, fs.constants.F_OK);
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(sourcePath, destPath);
          syncedCount++;
        } catch (error) {
          if (error.code === 'ENOENT') {
            logger.debug(`跳过同步，源文件不存在: ${sourcePath}`);
          } else {
            logger.error(`同步文件 ${relativePath} 失败 (源: ${sourcePath}):`, error);
          }
        }
      }
    }
    logger.info(`全量同步完成，成功复制了 ${syncedCount} 个文件`);
  },

  async _manageOptionalGameContentForAllRepos() {
    const allRepos = await GuGuNiuRepository.getAll();
    for (const repo of allRepos) {
      if (repo.containsOptionalContent && await repo.isDownloaded()) {
        await this._manageOptionalGameContent(repo.localPath, 'zzz', 'zzz-character');
        await this._manageOptionalGameContent(repo.localPath, 'waves', 'waves-character');
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