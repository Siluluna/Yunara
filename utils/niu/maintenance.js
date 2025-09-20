import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '#Yunara/utils/logger';
import { file } from '#Yunara/utils/file';
import { data } from '#Yunara/utils/data';
import { NiuRepository } from '#Yunara/models/GuGuNiu/repository';
import { Yunara_Temp_Path, Yunzai_Path } from '#Yunara/utils/path';
import { processService } from '#Yunara/utils/process';
import { filesize } from 'filesize';

const logger = createLogger('Yunara:Niu:MaintenanceService');

class MaintenanceService {

  /**
   * @public
   * @description 清理 Yunara 插件产生的临时文件
   */
  async cleanupTempFiles() {
    logger.info("开始执行临时文件清理任务...");
    let cleanedCount = 0;
    const tempDirsToClean = [
      Yunara_Temp_Path, // 清理 Yunara 自己的 temp 目录
      path.join(Yunzai_Path, "temp", "html") // 检查 Yunzai 的 temp/html
    ];

    for (const dirPath of tempDirsToClean) {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          // 匹配由 renderer 或 git 下载产生的临时文件夹
          if (entry.isDirectory() && (entry.name.toLowerCase().startsWith("guguniu") || entry.name.toLowerCase().startsWith("render-") || entry.name.toLowerCase().startsWith("tempclone-"))) {
            const dirToClean = path.join(dirPath, entry.name);
            if (await file.safeDelete(dirToClean)) {
              cleanedCount++;
              logger.debug(`已清理临时目录: ${dirToClean}`);
            }
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.error(`清理目录 ${dirPath} 时发生错误:`, err);
        }
      }
    }
    logger.info(`临时文件清理任务完成，共清理了 ${cleanedCount} 个临时目录。`);
  }

  /**
   * @public
   * @description 更新所有仓库的统计信息并缓存到 data/runtime.json
   */
  async updateRepoStatsCache() {
    logger.info("开始更新仓库统计信息缓存...");
    const startTime = Date.now();
    const allRepos = await NiuRepository.getAll();
    const statsCache = {};

    for (const repo of allRepos) {
      const defaultData = { sizeFormatted: "N/A", lastUpdate: "N/A", sha: "N/A", nodeName: "未知" };
      if (!(await repo.isDownloaded())) {
        statsCache[repo.id] = { ...defaultData, description: repo.description, downloaded: false };
        continue;
      }

      const totalSize = await file.folderSize(repo.localPath);
      let lastUpdate = "N/A";
      let sha = "获取失败";
      try {
        const logResult = await processService.execute({
          command: "git",
          args: ["log", "-1", "--pretty=format:%h (%cr)"],
          options: { cwd: repo.localPath }
        });
        const log = logResult.stdout.trim();
        if (log) {
            const shaMatch = log.match(/^([0-9a-f]+)/);
            const timeMatch = log.match(/\((.*)\)/);
            sha = shaMatch ? shaMatch[1] : "N/A";
            lastUpdate = timeMatch ? timeMatch[1] : "N/A";
        }
      } catch (err) { /* 忽略错误 */ }
      
      // TODO: 获取节点信息需要从 GitService 暴露一个方法
      const nodeName = "未知"; 

      statsCache[repo.id] = {
        description: repo.description,
        downloaded: true,
        sizeFormatted: filesize(totalSize, { base: 2, standard: "JEDEC" }),
        lastUpdate,
        sha,
        nodeName,
      };
    }

    await data.set('runtime.repoStats', statsCache);
    const duration = Date.now() - startTime;
    logger.info(`仓库统计缓存更新成功！耗时 ${duration}ms。`);
  }
}

export const maintenanceService = new MaintenanceService();