import plugin from '../../../../lib/plugins/plugin.js';
import { createLogger } from '#Yunara/utils/logger';
import { config } from '#Yunara/utils/config';
import { Yunzai_Path } from '#Yunara/utils/path';
import { segment } from 'oicq';
import common from '../../../../lib/common/common.js';
import path from 'node:path';

const logger = createLogger('Yunara:Niu:SleeperAgent');

const REDIS_KEYS_CONFIG = [
  { keyPrefix: 'miao:original-picture:', type: 'miao' },
  { keyPrefix: 'ZZZ:PANEL:IMAGE:', type: 'zzz' },
  { keyPrefix: 'Yunzai:waves:originpic:', type: 'waves' },
];

export class NiuSleeperAgent extends plugin {
  constructor() {
    super({
      name: '咕咕牛原图拦截器',
      dsc: '拦截指向咕咕牛图库的原图指令',
      event: 'message',
      priority: -10000, 
      rule: [
        {
          reg: /^#?原图$/,
          fnc: 'interceptImage'
        },
        {
          reg: /^#原图调试\s*([\s\S]+)$/, 
          fnc: 'debugImage',
          permission: 'master'
        }
      ]
    });
  }

  async debugImage(e) {
    const sourceMsgId = e.reg.exec(e.msg)[1].trim();
    if (!sourceMsgId) {
      return e.reply("调试命令格式错误，请使用 #原图调试 <消息ID>", true);
    }
    logger.info(`[SleeperAgent-Debug] 收到调试指令，目标消息ID: ${sourceMsgId}`);
    const processed = await this._processOriginalImage(e, sourceMsgId);
    if (!processed) {
      await e.reply(`[SleeperAgent-Debug] 未能为ID [${sourceMsgId}] 找到任何可拦截的原图信息。`, true);
    }
    return true;
  }

  async interceptImage(e) {
    // 检查是否有引用消息
    if (!e.source) return false;

    const sourceMsgId = e.source.message_id || e.source.seq;
    if (!sourceMsgId) return false;

    return this._processOriginalImage(e, sourceMsgId);
  }

  async _processOriginalImage(e, sourceMsgId) {
    const isEnabled = await config.get('niu.settings.SleeperAgentSwitch', false);
    if (!isEnabled) {
      return false; // 如果开关关闭，则不执行任何操作
    }

    for (const config of REDIS_KEYS_CONFIG) {
      try {
        const redisKey = `${config.keyPrefix}${sourceMsgId}`;
        const dataJson = await redis.get(redisKey);

        if (dataJson) {
          logger.debug(`[SleeperAgent] 在Redis [${redisKey}] 中找到 [${config.type}] 插件的数据`);
          
          let imagePathEncoded = '';
          if (config.type === 'miao') imagePathEncoded = JSON.parse(dataJson).img || '';
          else if (config.type === 'zzz') imagePathEncoded = dataJson;
          else if (config.type === 'waves') imagePathEncoded = (JSON.parse(dataJson).img || [])[0] || '';

          if (!imagePathEncoded) continue;

          const imagePath = decodeURIComponent(imagePathEncoded);
          const fileName = path.basename(imagePath);

          if (fileName.toLowerCase().includes('gu')) {
            logger.info(`[SleeperAgent] 拦截到咕咕牛图片 "${fileName}"，启动安全包装模式...`);
            
            const absolutePath = imagePath.startsWith('http') 
              ? imagePath 
              : path.join(Yunzai_Path, imagePath); 

            const characterName = fileName.replace(/Gu\d+\.webp$/i, '');
            const promptText = `输入 #咕咕牛查看 ${characterName} 可看该角色全部图片`;
            const imageSegment = segment.image(`file://${absolutePath.replace(/\\/g, "/")}`);

            const forwardList = [promptText, imageSegment];
            const forwardMsg = await common.makeForwardMsg(e, forwardList, `原图 - ${fileName}`);
            
            await e.reply(forwardMsg);
            await common.sleep(300);
            await e.reply(segment.at(e.user_id), false, { recallMsg: 15 });
            
            return true; 
          } else {
            // 非咕咕牛图片，放行
            return false;
          }
        }
      } catch (err) {
        logger.error(`[SleeperAgent] 处理 [${config.type}] 插件Redis数据时出错:`, err);
      }
    }
    return false;
  }
}
