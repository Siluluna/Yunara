import path from 'node:path';
import fs from 'node:fs/promises';
import { filesize } from 'filesize';
import { createLogger } from '#Yunara/utils/logger';
import { config } from '#Yunara/utils/config';
import { data } from '#Yunara/utils/data';
import { file } from '#Yunara/utils/file';
import { NiuDataService } from './data.js';
import { NiuRepository } from '#Yunara/models/niu/repository';

const logger = createLogger('Yunara:Niu:StatusService');

class StatusService {
  async generateStatusReport() {
    const report = {};
    report.repoStats = await this._getRepoStats();
    report.metaStats = await this._getMetadataStats();
    report.configStats = await this._getConfigStats();
    report.installationStats = await this._getInstallationStats();

    // TODO: 磁盘和机器人总体积统计 (这部分依赖 statfs，暂时搁置或寻找跨平台库)
    report.diskStats = { usedPercentage: 'N/A', totalSizeFormatted: 'N/A' };
    report.robotStats = { totalSizeFormatted: 'N/A' };

    return report;
  }

  async _getRepoStats() {
    const downloadedRepos = await NiuRepository.getDownloaded();
    const stats = {
      totalSize: 0,
      totalGitSize: 0,
      totalFilesSize: 0,
      repos: []
    };

    for (const repo of downloadedRepos) {
      const repoSize = await file.folderSize(repo.localPath);
      const gitSize = await file.folderSize(path.join(repo.localPath, '.git'));
      const filesSize = repoSize - gitSize;

      stats.totalSize += repoSize;
      stats.totalGitSize += gitSize;
      stats.totalFilesSize += filesSize;

      stats.repos.push({
        description: repo.description,
        sizeFormatted: filesize(repoSize, { base: 2, standard: "JEDEC" }),
        gitSizeFormatted: filesize(gitSize, { base: 2, standard: "JEDEC" }),
        filesSizeFormatted: filesize(filesSize, { base: 2, standard: "JEDEC" }),
        // TODO: 获取节点信息
        nodeName: '未知'
      });
    }
    
    stats.totalSizeFormatted = filesize(stats.totalSize, { base: 2, standard: "JEDEC" });
    stats.totalGitSizeFormatted = filesize(stats.totalGitSize, { base: 2, standard: "JEDEC" });
    stats.totalFilesSizeFormatted = filesize(stats.totalFilesSize, { base: 2, standard: "JEDEC" });

    return stats;
  }

  async _getMetadataStats() {
    const allImages = await NiuDataService.getImages();
    const characterSet = new Set(allImages.map(img => img.characterName));
    
    return {
      totalImages: allImages.length,
      totalRoles: characterSet.size,
      // TODO: 远程封禁数需要从 DataService 获取
      remoteBansCount: 0 
    };
  }

  async _getConfigStats() {
    const settings = await config.get('niu.settings') || {};
    const niu_userBans = await data.get('niu_userBans', []);
    const allImages = await NiuDataService.getImages();
    const purifiedBansCount = allImages.filter(img => img.isPurified(settings.PurificationLevel)).length;

    return {
      pflLevel: settings.PurificationLevel,
      pflDesc: this._getPflDescription(settings.PurificationLevel),
      niu_userBansCount: niu_userBans.length,
      purifiedBansCount: purifiedBansCount,
      activeBansCount: niu_userBans.length + purifiedBansCount,
      aiEnabled: settings.Filter?.Ai,
      easterEggEnabled: settings.Filter?.EasterEgg,
      layoutEnabled: settings.Filter?.Layout,
      isSerialMode: settings.ExecutionMode === 'Serial'
    };
  }

  async _getInstallationStats() {
      const coreRepo = await NiuRepository.getCoreRepository();
      if (!coreRepo || !(await coreRepo.isDownloaded())) {
          return { installationTime: 'N/A', installedDaysText: 'N/A' };
      }
      try {
        const stats = await fs.stat(coreRepo.localPath);
        const installationTime = new Date(stats.birthtime).toLocaleString('zh-CN');
        const diffDays = Math.floor((Date.now() - stats.birthtimeMs) / (1000 * 60 * 60 * 24));
        return { installationTime, installedDaysText: `${diffDays}天` };
      } catch (error) {
        logger.warn(`无法获取核心仓库 ${coreRepo.localPath} 的创建时间`);
        return { installationTime: 'N/A', installedDaysText: 'N/A' };
      }
  }

  _getPflDescription(level) {
    const descriptions = { 0: '不净化', 1: '轻度净化', 2: '严格净化' };
    return descriptions[level] || '未知';
  }
}

export const statusService = new StatusService();