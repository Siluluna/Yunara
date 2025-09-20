import plugin from '../../../lib/plugins/plugin.js';
import { config } from '#Yunara/utils/config';
import { createLogger } from '#Yunara/utils/logger';
import { renderer } from '#Yunara/utils/renderer';
import { aliasMatcher } from '#Yunara/utils/role/aliasmatcher';
import { file } from '#Yunara/utils/file';
import { Yunzai_Path, Yunara_Res_Path } from '#Yunara/utils/path';
import path from 'node:path';
import fs from 'node:fs/promises';

const logger = createLogger('Yunara:App:Visualize');

export class Visualize extends plugin {
  constructor() {
    super({
      name: "通用角色可视化",
      dsc: "可视化展示角色在各插件中的图片",
      event: "message",
      priority: 100, // 优先级可以设置得比咕咕牛查看低一些
      rule: [
        {
          reg: /^#?可视化\s*(.*)$/i,
          fnc: "visualizeCommand",
        },
      ],
    });
  }

  visualizeCommand = async (e) => {
    const characterInput = e.reg.exec(e.msg)[1].trim();
    if (!characterInput) {
      return e.reply("请输入要可视化的角色名，例如：#可视化 纳西妲", true);
    }

    try {
      const aliasResult = await aliasMatcher.find(characterInput);
      if (!aliasResult.success) {
        return e.reply(`在别名库中未找到名为「${characterInput}」的角色。`, true);
      }
      const characterName = aliasResult.name;

      const targetPath = await this._findCharacterSyncPath(characterName);
      if (!targetPath) {
        return e.reply(`在任何已配置的插件同步目录中，都未找到角色『${characterName}』的文件夹。`, true);
      }

      const allImageFiles = (await fs.readdir(targetPath)).filter(f => 
        f.toLowerCase().endsWith('.webp') || f.toLowerCase().endsWith('.png') || f.toLowerCase().endsWith('.jpg')
      );

      if (allImageFiles.length === 0) {
        return e.reply(`『${characterName}』的文件夹 [${path.basename(targetPath)}] 里没有找到支持的图片文件。`, true);
      }

      // 按文件名中的数字排序
      allImageFiles.sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)\.\w+$/)?.[1] || "0");
        const numB = parseInt(b.match(/(\d+)\.\w+$/)?.[1] || "0");
        return numA - numB;
      });

      await e.reply(`[${characterName}] 找到了 ${allImageFiles.length} 张图片，正在生成可视化预览图...`, true);
      
      // --- 渲染逻辑 ---
      const renderData = { 
        characterName: characterName, 
        imageCount: allImageFiles.length,
        // 将图片路径转换为渲染器可用的 file:// 协议绝对路径
        images: allImageFiles.map(f => `file://${path.join(targetPath, f).replace(/\\/g, '/')}`) 
      };

      const templatePath = path.join(Yunara_Res_Path, 'visualize', 'html', 'visualize.html');

      const imageBase64 = await renderer.render({
          templatePath: templatePath,
          data: renderData,
      });

      if (imageBase64) {
          await e.reply(segment.image(`base64://${imageBase64}`));
      } else {
          throw new Error("渲染器返回了空的数据");
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        return e.reply(`角色「${characterInput}」的目录中没有找到任何图片。`, true);
      }
      logger.error("执行 #可视化 指令时出错:", error);
      return e.reply("生成可视化面板时遇到错误，请检查日志。", true);
    }
    return true;
  }

  /**
   * @private
   * @description [通用方法] 扫描所有插件的同步目录，查找角色文件夹
   */
  async _findCharacterSyncPath(characterName) {
    const exPlugins = await config.get('externalPlugins', {});
    
    // 收集所有不重复的 syncTarget 路径
    const syncTargets = new Set();
    if (exPlugins.miao?.syncTarget) syncTargets.add(exPlugins.miao.syncTarget);
    if (exPlugins.zzz?.syncTarget) syncTargets.add(exPlugins.zzz.syncTarget);
    if (exPlugins.waves?.syncTarget) syncTargets.add(exPlugins.waves.syncTarget);
    // 未来可以继续添加其他插件

    if (syncTargets.size === 0) {
        logger.warn('未在 ex_plugins.yaml 中配置任何 syncTarget，无法进行可视化扫描。');
        return null;
    }

    // 遍历所有已知的同步目录
    for (const target of syncTargets) {
        const potentialPath = path.join(Yunzai_Path, target, characterName);
        if (await file.exists(potentialPath)) {
            logger.info(`可视化：在 [${target}] 中找到了角色 [${characterName}] 的文件夹。`);
            return potentialPath; // 找到第一个就返回
        }
    }

    return null; // 遍历完都没找到
  }
}