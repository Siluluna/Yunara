import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '#Yunara/utils/logger';
import { config } from '#Yunara/utils/config';
import { git } from '#Yunara/utils/git';
import { data } from '#Yunara/utils/data';
import { file } from '#Yunara/utils/file';
import { Yunara_Repos_Path, Yunzai_Path } from '#Yunara/utils/path';
import { NiuDataService } from '#Yunara/utils/niu/data';
import { NiuRepository } from '#Yunara/models/niu/repository';

const logger = createLogger('Yunara:Niu:RunSetup');

const PURIFY_LEVEL_MAP = {
  0: '0 ',
  1: '1 (仅屏蔽R18)',
  2: '2 (屏蔽R18 和 P18)',
};

const setupManager = {
  async runPostDownloadSetup(e) {
    logger.info("开始执行下载后设置流程...");

    logger.info("初始化用户封禁数据文件 (niu_bans.json)...");
    try {
      const currentBans = await data.get('niu_userBans', []);
      await data.set('niu_userBans', currentBans);
      logger.info("数据文件检查完成。");
    } catch (error) {
      logger.error("初始化 niu_bans.json 文件失败:", error);
    }

    await this._manageOptionalGameContentForAllRepos();
    logger.info("强制刷新元数据...");
    await NiuDataService.refresh();
    await this._performSyncing({ isInitialSync: true });
    logger.info("下载后设置流程全部完成。");
  },

  async runPostUpdateSetup(e) {
    logger.info("开始执行更新后设置流程...");
    await this._manageOptionalGameContentForAllRepos(); 
    await NiuDataService.refresh();
    await this._performSyncing({ isInitialSync: false });
    logger.info("更新后设置流程全部完成。");
  },

  async _cleanAllNiuImages(targetPaths) {
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
    const allImages = await NiuDataService.getImages();
    const niu_userBans = new Set(await data.get('niu_userBans', []));
    const settings = await config.get('niu.settings') || {};

    logger.info("--- 开始同步前配置审查 ---");
    logger.info(`图库总开关 (TuKuOP): ${settings.TuKuOP ? '开启' : '关闭'}`);
    logger.info(`AI 图像 (enableAI): ${settings.enableAI ? '允许' : '禁止'}`);
    logger.info(`横屏图像 (enableLandscape): ${settings.enableLandscape ? '允许' : '禁止'}`);
    logger.info(`彩蛋图像 (enableEasterEgg): ${settings.enableEasterEgg ? '允许' : '禁止'}`);
    const purifyLevelText = PURIFY_LEVEL_MAP[settings.purifyLevel] || `${settings.purifyLevel} (未知等级)`;
    logger.info(`PFL 净化等级 (purifyLevel): ${purifyLevelText}`);
    logger.info(`已加载元数据: ${allImages.length} 条`);
    logger.info(`用户手动封禁: ${niu_userBans.size} 条`);
    logger.info("--------------------------");


    if (allImages.length === 0) {
        logger.warn("元数据为空，无法进行文件同步");
        return;
    }

    const allowedImages = allImages.filter(image => image.isAllowed(settings, niu_userBans));
    const allowMap = new Map(allowedImages.map(image => [image.path, image]));
    logger.info(`根据当前规则，共计算出 ${allowMap.size} 张图片允许同步`);

    await this._syncFilesWithClean(allowMap);
  },

  async _syncFilesWithClean(allowMap) {
    const externalPlugins = await config.get('externalPlugins') || {};
    const targetPaths = {
      gs: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      sr: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      zzz: externalPlugins.zzz?.syncTarget ? path.join(Yunzai_Path, externalPlugins.zzz.syncTarget) : null,
      waves: externalPlugins.waves?.syncTarget ? path.join(Yunzai_Path, externalPlugins.waves.syncTarget) : null,
    };

    if (Object.values(targetPaths).every(p => p === null)) {
      logger.warn("警告：所有外部插件的同步目标 (syncTarget) 均未配置，无法进行文件同步。请检查 config/ex_plugins.yaml 文件。");
      return;
    }

    await this._cleanAllNiuImages(targetPaths);

    logger.info(`开始全量同步 ${allowMap.size} 张图片...`);
    let syncedCount = 0;
    const missingFiles = [];

    for (const image of allowMap.values()) {
      const gameKey = image.sourceGallery ? image.sourceGallery.split('-')[0] : 'unknown';
      const targetDir = targetPaths[gameKey];
      
      if (targetDir) {
        const sourcePath = path.join(
          Yunara_Repos_Path, 
          image.storagebox, 
          image.path
        );
        
        const fileName = path.basename(image.path);
        const destPath = path.join(targetDir, image.characterName, fileName);
        
        try {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(sourcePath, destPath);
          syncedCount++;
        } catch (error) {
          if (error.code === 'ENOENT') {
            missingFiles.push(sourcePath);
          } else {
            logger.error(`同步文件 ${fileName} 失败 (源: ${sourcePath}):`, error);
          }
        }
      }
    }
    
    logger.info(`全量同步完成，成功复制了 ${syncedCount} 个文件`);

    if (missingFiles.length > 0) {
      logger.warn(`有 ${missingFiles.length} 个文件存在于元数据中，但在本地仓库未找到，已自动跳过。这通常是正常的，可能是远程仓库的数据不一致导致。`);
      const filesToShow = missingFiles.slice(0, 10);
      logger.warn(`未找到的文件列表 (最多显示10个): \n- ${filesToShow.join('\n- ')}`);
    }
  },

  async _manageOptionalGameContentForAllRepos() {
    const allRepos = await NiuRepository.getAll();
    for (const repo of allRepos) {
      if (repo.containsOptionalGameContent && await repo.isDownloaded()) {
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
