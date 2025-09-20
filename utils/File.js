import fsExtra from "fs-extra";
import path from "node:path";
import { createLogger } from '#Yunara/utils/logger';

const logger = createLogger('Yunara:Utils:File');

const fileUtils = {
  async safeDelete(targetPath) {
    if (!targetPath) {
      return true;
    }
    try {
      await fsExtra.remove(targetPath);
      return true;
    } catch (error) {
      logger.error(`尝试安全删除 ${targetPath} 时最终失败:`, error);
      return false;
    }
  },

  async folderSize(folderPath) {
    let totalSize = 0;
    try {
      const entries = await fsExtra.readdir(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(folderPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.folderSize(entryPath);
        } else if (entry.isFile()) {
          const stats = await fsExtra.stat(entryPath);
          totalSize += stats.size;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`计算文件夹 ${path.basename(folderPath)} 大小时出错:`, error.message);
      }
    }
    return totalSize;
  },

  async copy(source, target, options = {}) {
      try {
          await fsExtra.copy(source, target, options);
          return true;
      } catch (error) {
          logger.error(`从 ${source} 复制到 ${target} 失败:`, error);
          return false;
      }
  },

  async exists(targetPath) {
    try {
      return await fsExtra.pathExists(targetPath);
    } catch (error) {
      logger.error(`检查路径 ${targetPath} 是否存在时出错:`, error);
      return false;
    }
  },

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
};

export const file = fileUtils;