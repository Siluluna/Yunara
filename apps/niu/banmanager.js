import plugin from '../../../../lib/plugins/plugin.js';
import { createLogger } from '#Yunara/utils/logger';
import { banService } from '#Yunara/utils/niu/ban';
import { setupManager } from './runsetup.js';
// import { renderer } from '#Yunara/utils/renderer';

const logger = createLogger('Yunara:Niu:BanManager');

export class NiuBanManager extends plugin {
  constructor() {
    super({
      name: "咕咕牛封禁管理",
      dsc: "管理用户手动封禁列表",
      event: "message",
      priority: 50,
      rule: [
        { reg: /^#?咕咕牛封禁列表$/i, 
          fnc: "BanList", 
          permission: "master" 
        },
        { 
          reg: /^#?咕咕牛封禁\s*(.+)$/i, 
          fnc: "addBan", 
          permission: "master" 
        },
        {
          reg: /^#?咕咕牛解禁\s*(.+)$/i,
          fnc: "removeBan",
          permission: "master",
        },
      ],
    });
  }


  BanList = async (e) => {
    try {
      await e.reply("正在整理封禁记录，请稍候...", true);
      const { niu_userBans, purifiedBans } = await banService.getCategorizedBanLists();

      if (niu_userBans.length === 0 && purifiedBans.length === 0) {
        return e.reply("当前没有任何图片被封禁或屏蔽。", true);
      }

      if (niu_userBans.length > 0) {
        await e.reply(`检测到 ${niu_userBans.length} 条手动封禁记录 (列表渲染待实现)。`, true);
      }

      if (purifiedBans.length > 0) {
        await e.reply(`检测到 ${purifiedBans.length} 条净化屏蔽记录 (列表渲染待实现)。`, true);
      }

    } catch (error) {
      logger.error("显示封禁列表时出错:", error);
      await e.reply("获取封禁列表失败，请检查日志。", true);
    }
    return true;
  }

  addBan = async (e) => {
    const identifier = e.reg.exec(e.msg)[1].trim();
    const findResult = await banService.findImageByIdentifier(identifier);

    if (!findResult.success) {
      return e.reply(findResult.message, true);
    }

    const image = findResult.image;
    const banResult = await banService.addUserBan(image);

    if (banResult.success) {
      await e.reply(`${banResult.message}\n正在后台应用规则...`, true);
      await setupManager._performSyncing({ isInitialSync: false });
      await e.reply("后台规则应用完成！", true);
    } else {
      await e.reply(banResult.message, true);
    }
    return true;
  }

  removeBan = async (e) => {
    const identifier = e.reg.exec(e.msg)[1].trim();
    const findResult = await banService.findImageByIdentifier(identifier);

    if (!findResult.success) {
      return e.reply(findResult.message, true);
    }

    const image = findResult.image;
    const unbanResult = await banService.removeUserBan(image);

    if (unbanResult.success) {
      await e.reply(`${unbanResult.message}\n正在后台应用规则...`, true);
      await setupManager._performSyncing({ isInitialSync: false });
      await e.reply("后台规则应用完成！", true);
    } else {
      await e.reply(unbanResult.message, true);
    }
    return true;
  }
}
