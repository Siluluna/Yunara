import puppeteer from "puppeteer";
import path from "node:path";
import fs from "node:fs/promises";
import template from "art-template";
import { createLogger } from "#Yunara/utils/Logger";
import { config } from "#Yunara/utils/Config";
import { Yunara_Temp_Path } from "#Yunara/utils/Path";
import { file as fileUtils } from "#Yunara/utils/File";

const logger = createLogger("Yunara:Utils:Renderer");

/**
 * @class RendererService
 * @description Yunara 的高级渲染服务。
 */
class RendererService {
  /** @private */
  browser = null;
  /** @private */
  #isStarting = false;
  /** @private */
  #renderCount = 0;
  /** @private */
  #config = {};

  constructor() {
    this.initialize();
  }

  /**
   * @private
   * @description 初始化服务，加载配置。
   */
  async initialize() {
    this.#config = await config.get('renderer');
    if (!this.#config) {
        logger.warn("渲染器配置 (Renderer.yaml) 未找到，将使用默认值。");
        this.#config = { restartThreshold: 100, timeout: 30000 };
    }
  }

  async #getBrowser() {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    if (this.#isStarting) {
      // 如果正在启动，等待启动完成
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.#getBrowser();
    }

    this.#isStarting = true;
    logger.info("Puppeteer 浏览器实例启动中...");

    try {
      const puppeteerConfig = {
        headless: this.#config.headless || "new",
        args: this.#config.args || [],
      };
      if (this.#config.puppeteerWS) {
        this.browser = await puppeteer.connect({ browserWSEndpoint: this.#config.puppeteerWS });
        logger.info(`已连接到外部浏览器实例: ${this.#config.puppeteerWS}`);
      } else {
        if (this.#config.chromiumPath) {
          puppeteerConfig.executablePath = this.#config.chromiumPath;
        }
        this.browser = await puppeteer.launch(puppeteerConfig);
        logger.info(`本地浏览器实例启动成功 (PID: ${this.browser.process().pid})`);
      }

      this.browser.on("disconnected", () => {
        logger.warn("浏览器实例已断开连接，将自动清理。");
        this.browser = null;
      });

      return this.browser;
    } catch (error) {
      logger.fatal("Puppeteer 浏览器启动失败:", error);
      this.browser = null;
      throw error;
    } finally {
      this.#isStarting = false;
    }
  }

  /**
   * @public
   * @description 核心渲染方法。
   * @param {object} options
   * @returns {Promise<Buffer|null>} 截图的 Buffer，失败则返回 null。
   */
  async render(options) {
    const {
      templatePath,
      data = {},
      screenshot = {},
    } = options;

    const browser = await this.#getBrowser();
    if (!browser) return null;

    const tempHtmlDir = path.join(Yunara_Temp_Path, 'renderer_html');
    await fs.mkdir(tempHtmlDir, { recursive: true });
    const htmlPath = path.join(tempHtmlDir, `${Date.now()}-${Math.random()}.html`);
    let page;

    try {
      const tplContent = await fs.readFile(templatePath, 'utf-8');
      const finalHtml = template.render(tplContent, data);
      await fs.writeFile(htmlPath, finalHtml);

      page = await browser.newPage();
      await page.goto(`file://${htmlPath}`, this.#config.pageGotoParams);

      await page.waitForFunction("window.dispatchEvent(new Event('yunara:render-ready'))", {
        timeout: this.#config.timeout || 30000,
      }).catch(async () => {
        // 如果超时，尝试直接截图作为备用方案
        logger.warn(`[${path.basename(templatePath)}] 渲染等待 'yunara:render-ready' 事件超时，将尝试直接截图。`);
        await new Promise(resolve => setTimeout(resolve, 1000)); 
      });

      const element = await page.$('body');
      const buffer = await element.screenshot({
        type: 'png',
        ...screenshot,
      });

      this.#renderCount++;
      return buffer;

    } catch (error) {
      logger.error(`渲染 [${path.basename(templatePath)}] 失败:`, error);
      return null;
    } finally {
      if (page) await page.close();
      await fileUtils.safeDelete(htmlPath);
      
      if (this.#config.restartThreshold > 0 && this.#renderCount >= this.#config.restartThreshold) {
        logger.info(`截图次数达到 ${this.#renderCount} 次，将重启浏览器实例以释放资源...`);
        this.#renderCount = 0;
        await this.restart();
      }
    }
  }

  async restart() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    logger.info("浏览器实例已关闭。");
  }
}

export const renderer = new RendererService();