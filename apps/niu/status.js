import plugin from '../../../../lib/plugins/plugin.js';
import { createLogger } from '#Yunara/utils/logger';
import { renderer } from '#Yunara/utils/renderer';
import { statusService } from '#Yunara/utils/niu/status';
import { NiuRepository } from '#Yunara/models/niu/repository';
import { version } from '#Yunara/utils/version';
import { config } from '#Yunara/utils/config';
import { Yunara_Res_Path } from '#Yunara/utils/path';
import path from 'node:path';

const logger = createLogger('Yunara:Niu:Status');

export class NiuStatus extends plugin {
  constructor() {
    super({
      name: '咕咕牛图库状态',
      dsc: '显示咕咕牛图库的详细状态报告和地图',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: /^#?咕咕牛状态$/i,
          fnc: 'showStatus',
          permission: 'master'
        }
      ]
    });
  }

  showStatus = async (e) => {
    const coreRepo = await NiuRepository.getCoreRepository();
    if (!coreRepo || !(await coreRepo.isDownloaded())) {
      return e.reply("『咕咕牛图库』核心库还没下载呢！先 `#下载咕咕牛图库` 吧！", true);
    }

    try {
      await e.reply("收到！正在为您生成咕咕牛图库状态报告，请稍候...", true);

      const reportData = await statusService.generateStatusReport();
      
      const renderScale = await config.get('niu.settings.RenderScale', 100);
      const finalRenderData = {
        ...reportData,
        pluginVersion: await version.get(),
        scaleStyleValue: `transform:scale(${renderScale / 100}); transform-origin: top left;`,
        yunara_res_path: `file://${Yunara_Res_Path.replace(/\\/g, '/')}/`
      };

      const templatePath = path.join(Yunara_Res_Path, 'GuGuNiu', 'html', 'status', 'status.html');
      const imageBuffer = await renderer.render({
        templatePath: templatePath,
        data: finalRenderData,
      });

      if (imageBuffer) {
        await e.reply(imageBuffer);
      } else {
        throw new Error("渲染器返回了空的 Buffer");
      }

      // TODO: 在这里添加图库地图的生成和发送逻辑
      // const mapImages = await statusService.generateMapImages();
      // const forwardMsg = await common.makeForwardMsg(e, mapImages, "咕咕牛图库地图总览");
      // await e.reply(forwardMsg);

    } catch (error) {
      logger.fatal("生成状态报告时发生顶层异常:", error);
      await e.reply(`生成状态报告失败，请检查日志。错误: ${error.message}`, true);
    }
    return true;
  }
}
