import plugin from '../../../../lib/plugins/plugin.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '#Yunara/utils/logger';
import { file } from '#Yunara/utils/file';
import { config } from '#Yunara/utils/config';
import { data } from '#Yunara/utils/data';
import { NiuDataService } from '#Yunara/utils/niu/data';
import { Yunara_Repos_Path, Yunzai_Path } from '#Yunara/utils/path';

const logger = createLogger('Yunara:Niu:Reset');

export class NiuReset extends plugin {
  constructor() {
    super({
      name: '咕咕牛图库重置',
      dsc: '清理所有咕咕牛图库相关的文件和缓存',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: /^#?重置咕咕牛$/i,
          fnc: 'resetTuKu',
          permission: 'master'
        }
      ]
    });
  }

  resetTuKu = async (e) => {
    try {
      await e.reply("收到！开始执行重置流程，这将清理所有本地仓库和同步文件，请稍候...", true);

      const errors = [];

      await this._cleanRepoDirectories(errors);

      await this._cleanSyncedImages(errors);

      await this._resetRuntimeData(errors);

      if (errors.length > 0) {
        const errorMessage = `重置过程中发生错误:\n- ${errors.join('\n- ')}`;
        await e.reply(errorMessage, true);
        logger.error(errorMessage);
      } else {
        await e.reply("重置完成！所有相关文件和缓存都已清理干净。", true);
      }

    } catch (error) {
      logger.fatal("执行 #重置咕咕牛 指令时发生顶层异常:", error);
      await e.reply(`重置过程中发生严重错误：${error.message}\n请检查日志！`, true);
    }
    return true;
  }

  async _cleanRepoDirectories(errors) {
    logger.info("开始清理仓库目录...");
    try {
      const entries = await fs.readdir(Yunara_Repos_Path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const repoPath = path.join(Yunara_Repos_Path, entry.name);
          logger.debug(`正在删除仓库目录: ${repoPath}`);
          await file.safeDelete(repoPath);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error("清理仓库目录时出错:", error);
        errors.push("清理仓库目录失败");
      }
    }
  }

  async _cleanSyncedImages(errors) {
    logger.info("开始清理已同步的图片...");
    try {
      const externalPlugins = await config.get('exPlugins') || {};
      const targetPaths = this._getTargetPaths(externalPlugins);
      
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
          if (error.code !== 'ENOENT') throw error;
        }
      });
      await Promise.all(cleanPromises);
      logger.info(`文件清理完成，共移除了 ${cleanedCount} 个旧图库文件`);

    } catch (error) {
      logger.error("清理已同步图片时出错:", error);
      errors.push("清理已同步图片失败");
    }
  }

  async _resetRuntimeData(errors) {
    logger.info("开始清理运行时数据并重置内存状态...");
    try {
      const banListPath = path.join(Yunzai_Path, 'plugins', 'Yunara', 'data', 'niu_bans.json');
      await file.safeDelete(banListPath);
      
      // 重置内存中的数据
      await data.set('niu_userBans', []);
      await NiuDataService.refresh();
    } catch (error) {
      logger.error("清理运行时数据或重置内存时出错:", error);
      errors.push("清理运行时数据失败");
    }
  }

  _getTargetPaths(externalPlugins) {
    return {
      gs: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      sr: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      zzz: externalPlugins.zzz?.syncTarget ? path.join(Yunzai_Path, externalPlugins.zzz.syncTarget) : null,
      waves: externalPlugins.waves?.syncTarget ? path.join(Yunzai_Path, externalPlugins.waves.syncTarget) : null,
    };
  }
}
