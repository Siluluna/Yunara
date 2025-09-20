import { createLogger } from '#Yunara/utils/logger';
import { data } from '#Yunara/utils/data';
import { config } from '#Yunara/utils/config';
import { NiuDataService } from './data.js';
import { aliasMatcher } from '#Yunara/utils/role/aliasmatcher';

const logger = createLogger('Yunara:Niu:BanService');

class BanService {

  /**
   * @public
   * @description 根据输入查找对应的图片模型
   * @param {string} identifier - "角色名+编号" 格式的字符串
   * @returns {Promise<{success: boolean, image?: GuGuNiuImage, message?: string}>}
   */
  async findImageByIdentifier(identifier) {
    const match = identifier.match(/^([^\d]+)(\d+)$/);
    if (!match) {
      return { success: false, message: "格式错误，应为 角色名+编号 (例如：花火1)" };
    }
    const [, inputName, imageNumber] = match;

    const aliasResult = await aliasMatcher.find(inputName);
    if (!aliasResult.success) {
      return { success: false, message: `未找到名为「${inputName}」的角色。` };
    }
    const standardName = aliasResult.name;

    const allImages = await NiuDataService.getImages();
    const expectedFilename = `${standardName.toLowerCase()}gu${imageNumber}.webp`;
    const image = allImages.find(img => img.path.toLowerCase().endsWith(`/${expectedFilename}`));

    if (!image) {
      return { success: false, message: `在「${standardName}」的图库中未找到编号为 ${imageNumber} 的图片。` };
    }
    return { success: true, image };
  }

  /**
   * @public
   * @description 添加用户封禁，内置净化规则检查
   * @param {GuGuNiuImage} image - 要封禁的图片模型实例
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async addUserBan(image) {
    const settings = await config.get('niu.settings') || {};
    // 检查图片是否已被净化规则屏蔽
    if (image.isPurified(settings.PurificationLevel)) {
      const fileName = image.path.split('/').pop();
      return {
        success: false,
        message: `⚠️ 操作失败！「${fileName}」正受到当前净化规则 (等级 ${settings.PurificationLevel}) 的屏蔽，无法进行手动封禁。`
      };
    }

    const niu_userBans = await data.get('niu_userBans', []);
    const banSet = new Set(niu_userBans);
    if (banSet.has(image.path)) {
      return { success: false, message: "该图片已经被封禁了，无需重复操作。" };
    }

    banSet.add(image.path);
    await data.set('niu_userBans', Array.from(banSet));
    return { success: true, message: `「${image.characterName} - ${image.path.split('/').pop()}」🚫 已成功封禁。` };
  }

  /**
   * @public
   * @description 移除用户封禁，内置净化规则检查
   * @param {GuGuNiuImage} image - 要解禁的图片模型实例
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async removeUserBan(image) {
    const settings = await config.get('niu.settings') || {};
    // 检查图片是否已被净化规则屏蔽
    if (image.isPurified(settings.PurificationLevel)) {
      const fileName = image.path.split('/').pop();
      return {
        success: false,
        message: `⚠️ 操作失败！「${fileName}」正受到当前净化规则 (等级 ${settings.PurificationLevel}) 的屏蔽，无法进行手动解禁。`
      };
    }

    const niu_userBans = await data.get('niu_userBans', []);
    const banSet = new Set(niu_userBans);
    if (!banSet.has(image.path)) {
      return { success: false, message: "该图片并未被手动封禁。" };
    }

    banSet.delete(image.path);
    await data.set('niu_userBans', Array.from(banSet));
    return { success: true, message: `「${image.characterName} - ${image.path.split('/').pop()}」✅ 已成功解禁。` };
  }

  async getCategorizedBanLists() {
    const allImages = await NiuDataService.getImages();
    const niu_userBansSet = new Set(await data.get('niu_userBans', []));
    const settings = await config.get('niu.settings') || {};

    const niu_userBans = [];
    const purifiedBans = [];

    for (const image of allImages) {
      if (niu_userBansSet.has(image.path)) {
        niu_userBans.push(image);
        continue;
      }

      if (!image.isAllowed(settings, new Set())) {
        const reasons = [];
        if (image.isPurified(settings.PurificationLevel)) reasons.push("净化");
        if (settings.Filter?.Ai === false && image.attributes.isAiImage) reasons.push("AI");
        if (settings.Filter?.EasterEgg === false && image.attributes.isEasterEgg) reasons.push("彩蛋");
        if (settings.Filter?.Layout === false && image.attributes.layout === "fullscreen") reasons.push("横屏");
        
        if (reasons.length > 0) {
          purifiedBans.push({ image, reasons });
        }
      }
    }
    return { niu_userBans, purifiedBans };
  }
}

export const banService = new BanService();