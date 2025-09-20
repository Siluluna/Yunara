import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '#Yunara/utils/logger';
import { NiuRepository } from '#Yunara/models/niu/repository';

const logger = createLogger('Yunara:Niu:LocalScan');

class NiuLocalScan {

  /**
   * @public
   * @description  启动一次完整的本地文件扫描。
   * @returns {Promise<Array<{storagebox: string, path: string, characterName: string}>>}
   *          返回一个数组，包含所有在本地找到的图片信息。
   *          - storagebox: 图片所在的仓库名 (e.g., 'guguniu-gallery-Genshin')
   *          - path: 图片在仓库内的相对路径 (e.g., 'gs-character/nahida/Gu1.webp')
   *          - characterName: 图片所属的角色名 (e.g., 'nahida')
   */
  async scan() {
    logger.info('开始执行本地图库文件全量扫描...');
    
    const downloadedRepos = await NiuRepository.getDownloaded();
    if (downloadedRepos.length === 0) {
      logger.warn('未找到任何已下载的咕咕牛仓库，本地扫描结束。');
      return [];
    }

    logger.info(`检测到 ${downloadedRepos.length} 个已下载的仓库，正在并发扫描...`);

    const resultsPerRepo = await Promise.all(
      downloadedRepos.map(repo => this._scanRepository(repo))
    );

    const allFoundFiles = resultsPerRepo.flat();

    logger.info(`本地扫描完成，共找到 ${allFoundFiles.length} 个 .webp 图片文件。`);
    return allFoundFiles;
  }

  /**
   * @private
   * @description 扫描单个仓库目录下的所有图片文件。
   * @param {NiuRepository} repo - NiuRepository 的实例
   * @returns {Promise<Array<object>>}
   */
  async _scanRepository(repo) {
    const foundFilesInRepo = [];
    try {
      const gameFolders = await fs.readdir(repo.localPath, { withFileTypes: true });

      for (const gameFolder of gameFolders) {
        if (!gameFolder.isDirectory()) continue;

        const gameFolderPath = path.join(repo.localPath, gameFolder.name);
        try {
          const characterFolders = await fs.readdir(gameFolderPath, { withFileTypes: true });

          for (const charFolder of characterFolders) {
            if (!charFolder.isDirectory()) continue;

            const charFolderPath = path.join(gameFolderPath, charFolder.name);
            try {
              const imageFiles = await fs.readdir(charFolderPath);

              for (const imageFile of imageFiles) {
                if (imageFile.toLowerCase().endsWith('.webp')) {
                  const relativePath = path.join(gameFolder.name, charFolder.name, imageFile).replace(/\\/g, "/");
                  
                  foundFilesInRepo.push({
                    storagebox: repo.name,
                    path: relativePath,
                    characterName: charFolder.name
                  });
                }
              }
            } catch (err) {
              logger.warn(`读取角色目录 [${charFolderPath}] 失败: ${err.message}`);
            }
          }
        } catch (err) {
          logger.warn(`读取游戏目录 [${gameFolderPath}] 失败: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`扫描仓库 [${repo.name}] 失败: ${err.message}`);
    }
    return foundFilesInRepo;
  }
}

export const niuScan = new NiuLocalScan();