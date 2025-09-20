import path from 'node:path';
import fs from 'node:fs/promises';
import lodash from 'lodash';
import { createLogger } from '#Yunara/utils/logger';
import { Yunara_Repos_Path } from '#Yunara/utils/path';
import { data } from '#Yunara/utils/data';

const logger = createLogger('Yunara:Niu:DataService');

class NiuImage {
  constructor(imageData) {
    this.path = imageData.path;
    this.characterName = imageData.characterName;
    this.storagebox = imageData.storagebox;
    this.sourceGallery = imageData.sourceGallery;
    const attrs = imageData.attributes || {};
    this.attributes = {
      isAiImage: attrs.isAiImage ?? false,
      isRx18: attrs.isRx18 ?? false,
      isPx18: attrs.isPx18 ?? false,
      isEasterEgg: attrs.isEasterEgg ?? false,
      layout: attrs.layout ?? 'unknown',
      secondaryTags: attrs.secondaryTags || []
    };
  }

  /**
   * @description 根据用户设置和封禁列表，判断该图片是否允许显示。
   * @param {object} settings - 咕咕牛的设置对象
   * @param {Set<string>} userBans - 用户手动封禁的图片路径集合
   * @returns {boolean}
   */
  isAllowed(settings, userBans) {
    if (!settings.TuKuOP) return false;
    if (userBans.has(this.path)) return false;

    const filterSettings = settings.Filter || {};

    if (filterSettings.Ai === false && this.attributes.isAiImage) return false;
    if (filterSettings.Layout === false && this.attributes.layout === 'landscape') return false;
    if (filterSettings.EasterEgg === false && this.attributes.isEasterEgg) return false;
    
    const purifyLevel = settings.PurificationLevel ?? 0;
    if (purifyLevel >= 1 && this.attributes.isRx18) return false;
    if (purifyLevel >= 2 && this.attributes.isPx18) return false;
    
    return true;
  }
}

class NiuDataServiceController {
  #images = [];
  #secondaryTags = [];
  #isInitialized = false;
  #initializationPromise = null;

  constructor() {
    this.#initializationPromise = this.refresh();
  }

  async #ensureInitialized() {
    await this.#initializationPromise;
  }

  async refresh() {
    logger.info('正在加载咕咕牛核心数据...');

    const [imageData, tagsData] = await Promise.all([
      data.get('niu_imagedata', []),
      data.get('niu_secondary_tags', {})
    ]);

    const allImages = [];
    if (Array.isArray(imageData)) {
      for (const imgData of imageData) {
        if (!imgData.storagebox || !imgData.path || !imgData.characterName) {
            logger.warn(`[元数据警告] 发现一条不完整的图片记录，已跳过。`, imgData);
            continue;
        }
        allImages.push(new NiuImage(imgData));
      }
    } else {
      logger.error(`[元数据格式错误] imagedata.json 的内容不是一个有效的 JSON 数组！`);
    }
    this.#images = allImages;

    let allTags = [];
    if (tagsData && typeof tagsData === 'object' && !Array.isArray(tagsData)) {
      allTags = Object.values(tagsData).flat();
    } else {
      logger.error(`[元数据格式错误] SecondTags.json 的内容不是一个有效的 JSON 对象！`);
    }
    this.#secondaryTags = allTags;

    this.#isInitialized = true;
    logger.info(`咕咕牛元数据加载完成。图片: ${this.#images.length} 条，二级标签: ${this.#secondaryTags.length} 个`);
  }

  async getImages() {
    await this.#ensureInitialized();
    return lodash.cloneDeep(this.#images);
  }

  async getSecondaryTags() {
    await this.#ensureInitialized();
    return lodash.cloneDeep(this.#secondaryTags);
  }
}

export const NiuDataService = new NiuDataServiceController();