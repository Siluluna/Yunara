import path from 'node:path';
import fs from 'node:fs'; 
import yaml from 'yaml';
import { createLogger } from '#Yunara/utils/logger';
import { Yunzai_Path } from '#Yunara/utils/path';
import Bot from '../../../../lib/bot.js';
import common from '../../../../lib/common/common.js';

const logger = createLogger('Yunara:Utils:Master:Notification');

class NotificationService {
  /** @private @type {string[]|null} 缓存主人QQ列表 */
  #masterQQList = null;

  /**
   * @public
   * @description [核心公共接口] 向主人发送消息
   * @param {string|object} message - 要发送的消息内容 (可以是字符串或 oicq 段)
   * @param {number} [delay=0] - 发送前的延迟（毫秒）
   */
  async sendToMaster(message, delay = 0) {
    if (delay > 0) {
      await common.sleep(delay);
    }

    const masters = await this._getMasters();
    if (masters.length === 0) {
      logger.warn("未能获取到有效的主人QQ，无法发送通知。");
      return false;
    }

    // 默认只发送给第一个主人
    const masterId = masters[0];
    try {
      const contact = Bot.pickUser(masterId);
      if (contact && typeof contact.sendMsg === 'function') {
        await contact.sendMsg(message);
        logger.info(`通知已成功发送给主人 [${masterId}]。`);
        return true;
      } else {
        logger.warn(`未能为主人QQ [${masterId}] 获取到有效的用户对象。`);
        return false;
      }
    } catch (error) {
      logger.error(`向主人 [${masterId}] 发送通知时失败:`, error);
      return false;
    }
  }

  /**
   * @private
   * @description 获取并缓存主人QQ列表，包含所有兜底逻辑
   * @returns {Promise<string[]>}
   */
  async _getMasters() {
    // 如果已有缓存，直接返回
    if (this.#masterQQList !== null) {
      return this.#masterQQList;
    }

    const mastersRaw = new Set();

    // 尝试从 Bot.master 获取
    if (Bot.master && Bot.master.length > 0) {
      (Array.isArray(Bot.master) ? Bot.master : [Bot.master]).forEach(m => mastersRaw.add(String(m)));
    }

    // 尝试从 Bot.getConfig 获取
    if (typeof Bot.getConfig === 'function') {
      try {
        const configMaster = Bot.getConfig('masterQQ') || Bot.getConfig('master');
        if (configMaster) {
          (Array.isArray(configMaster) ? configMaster : [configMaster]).forEach(m => mastersRaw.add(String(m)));
        }
      } catch (err) { /* 静默 */ }
    }

    // 兜底：直接读取 other.yaml
    if (mastersRaw.size === 0) {
      try {
        const configPath = path.join(Yunzai_Path, 'config', 'config', 'other.yaml');
        if (fs.existsSync(configPath)) {
          const fileContent = fs.readFileSync(configPath, 'utf8');
          const configData = yaml.parse(fileContent);
          if (configData) {
            const masterQQ = configData.masterQQ || configData.master;
            if (masterQQ) {
              (Array.isArray(masterQQ) ? masterQQ : [masterQQ]).forEach(m => mastersRaw.add(String(m)));
            }
          }
        }
      } catch (err) {
        logger.error("兜底读取 other.yaml 失败:", err.message);
      }
    }

    this.#masterQQList = Array.from(mastersRaw)
      .map(id => String(id).trim().replace(/^[zZ]:?/, '')) // 移除可能的前缀，如 "z:"
      .filter(id => /^[1-9][0-9]{4,14}$/.test(id)); // 验证QQ号格式

    if (this.#masterQQList.length > 0) {
      logger.debug(`成功获取并缓存主人QQ列表: [${this.#masterQQList.join(', ')}]`);
    }

    return this.#masterQQList;
  }
}

export const notificationService = new NotificationService();