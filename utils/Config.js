import path from "node:path";
import fs from "node:fs/promises";
import yaml from "yaml";
import lodash from "lodash";
import { createLogger } from "#Yunara/utils/Logger";
import { Yunara_Config_Path } from "#Yunara/utils/Path";

const logger = createLogger("Yunara:Utils:Config");

/**
 * @description 定义 Yunara 所有分层配置文件的路径及其在全局配置对象中的映射关系。
 * @private
 */
const CONFIG_FILES = {
  yunara: {
    path: path.join(Yunara_Config_Path, "Yunara.yaml"),
    dataKey: "yunara"
  },
  git: {
    path: path.join(Yunara_Config_Path, "Git.yaml"),
    dataKey: "git"
  },
  renderer: {
    path: path.join(Yunara_Config_Path, "Renderer.yaml"),
    dataKey: "renderer"
  },
  externalPlugins: {
    path: path.join(Yunara_Config_Path, "Ex-Plugins.yaml"),
    dataKey: "externalPlugins"
  },
  guguniu_gallery: {
    path: path.join(Yunara_Config_Path, "GuGuNiu", "Gallery.yaml"),
    dataKey: "guguniu.gallery"
  },
  guguniu_settings: {
    path: path.join(Yunara_Config_Path, "GuGuNiu", "Settings.yaml"),
    dataKey: "guguniu.settings"
  },
  guguniu_webui: {
    path: path.join(Yunara_Config_Path, "GuGuNiu", "Webui.yaml"),
    dataKey: "guguniu.webui"
  },
};
/**
 * @class ConfigService
 * @description Yunara 的核心配置服务。
 * 负责在启动时异步加载所有分层 YAML 配置文件，
 * 并提供一个统一的、安全的接口来读取和持久化配置。
 * 采用真私有字段#和单例模式，确保配置状态的唯一性和封装性。
 */
class ConfigService {
  /** @private @type {object} 存储所有配置的内存快照 */
  #config = {};
  /** @private @type {boolean} 标记初始化是否已完成 */
  #isInitialized = false;
  /** @private @type {Promise<void>|null} 用于确保所有操作等待初始化完成的 Promise */
  #initializationPromise = null;

  /**
   * @constructor
   * @description
   * 构造函数不执行任何实际的 I/O 操作，以保持实例化过程的同步和快速。
   * 仅启动一个异步的 `#initialize` 过程，并将该过程的 Promise 存放在 `#initializationPromise` 中。
   * “异步初始化守护”模式是核心设计，确保任何外部调用都能安全等待配置加载完毕。
   */
  constructor() {
    this.#initializationPromise = this.#initialize();
  }

  /**
   * @private
   * @description
   * 负责异步地从磁盘读取所有在 CONFIG_FILES 中定义的 YAML 文件，
   * 解析它们，并使用 lodash.set 将它们合并到内存中的 #config 对象。
   * 此方法只会在服务实例化时执行一次。
   */
  async #initialize() {
    if (this.#isInitialized) return;

    const loadedConfig = {};
    await Promise.all(
      Object.values(CONFIG_FILES).map(async (fileInfo) => {
        try {
          const fileContent = await fs.readFile(fileInfo.path, "utf8");
          const parsedConfig = yaml.parse(fileContent);
          if (parsedConfig && typeof parsedConfig === 'object') {
            lodash.set(loadedConfig, fileInfo.dataKey, parsedConfig);
          }
        } catch (error) {
          if (error.code === 'ENOENT') {
            logger.debug(`配置文件 ${fileInfo.path} 不存在，将跳过。`);
          } else {
            logger.error(`读取或解析配置文件 ${fileInfo.path} 失败：`, error);
          }
        }
      })
    );

    this.#config = loadedConfig;
    this.#isInitialized = true;
    logger.info("配置服务初始化完成。");
  }

  /**
   * @public
   * 获取一个配置项的值。这是读取配置的唯一公共接口。
   * @param {string} key 使用点分路径的键名 (e.g., 'guguniu.gallery.version')。
   * @param {*} [defaultValue=undefined] 如果未找到键，则返回此默认值。
   * @returns {Promise<*>} 配置项的值。
   */
  async get(key, defaultValue = undefined) {
    // 确保在访问配置之前，异步初始化已完成。
    await this.#initializationPromise;
    return lodash.get(this.#config, key, defaultValue);
  }

  /**
   * @public
   * 设置一个配置项的值，并将其持久化到对应的 YAML 文件中。
   * @param {string} key 使用点分路径的键名 (e.g., 'guguniu.gallery.autoUpdate')。
   * @param {*} value 要设置的值。
   * @returns {Promise<boolean>} 如果成功则返回 true，否则抛出错误。
   */
  async set(key, value) {
    // 确保在访问配置之前，异步初始化已完成。
    await this.#initializationPromise;
    
    // 智能查找该 key 属于哪个配置文件域。
    // 通过查找最长匹配的 dataKey，确保了配置项被正确地归类。
    const fileKey = Object.keys(CONFIG_FILES)
      .filter(k => key.startsWith(CONFIG_FILES[k].dataKey))
      .sort((a, b) => CONFIG_FILES[b].dataKey.length - CONFIG_FILES[a].dataKey.length)[0];

    if (!fileKey) {
      throw new Error(`配置项 "${key}" 不属于任何已知的配置文件域。`);
    }

    // 在内存中更新值
    lodash.set(this.#config, key, value);
    
    // 持久化到磁盘
    return this.#saveConfigFile(fileKey);
  }

  /**
   * @private
   * 将指定配置文件域的数据从内存写入磁盘。
   * @param {string} fileKey CONFIG_FILES 中的键名 (e.g., 'guguniu_gallery')。
   * @returns {Promise<boolean>}
   */
  async #saveConfigFile(fileKey) {
    const fileInfo = CONFIG_FILES[fileKey];
    if (!fileInfo) {
        throw new Error(`无法保存配置，未知的配置文件键: ${fileKey}`);
    }

    const dataToSave = lodash.get(this.#config, fileInfo.dataKey);
    
    if (!dataToSave || typeof dataToSave !== 'object') {
        logger.warn(`配置域 ${fileInfo.dataKey} 的数据为空或不是对象，将写入一个空对象以防意外。`);
        const yamlString = yaml.stringify({});
        await fs.mkdir(path.dirname(fileInfo.path), { recursive: true });
        await fs.writeFile(fileInfo.path, yamlString, "utf8");
        return true;
    }

    try {
      const yamlString = yaml.stringify(dataToSave);
      await fs.mkdir(path.dirname(fileInfo.path), { recursive: true });
      await fs.writeFile(fileInfo.path, yamlString, "utf8");
      logger.debug(`配置文件 ${fileInfo.path} 已成功保存。`);
      return true;
    } catch (error) {
      logger.error(`写入配置文件 ${fileInfo.path} 失败:`, error);
      throw error;
    }
  }
}

export const config = new ConfigService();