import fs from 'node:fs/promises';
import path from 'node:path';
import { Yunara_Path } from '#Yunara/utils/Path';
import { createLogger } from '#Yunara/utils/Logger';

const logger = createLogger('Yunara:Utils:Version');
const packageJsonPath = path.join(Yunara_Path, 'package.json');


const versionService = {
  _version: 'unknown',
  _isInitialized: false,
  _initializationPromise: null,
  
  async _initialize() {
    if (this._isInitialized) return;

    try {
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent);
      this._version = packageJson.version || 'unknown';
    } catch (error) {
      logger.error('无法从 package.json 读取或解析版本号，将使用默认值 "unknown":', error);
    } finally {
      this._isInitialized = true;
      logger.debug(`版本服务初始化完成，当前版本: ${this._version}`);
    }
  },

  async get() {
    await this._initializationPromise;
    return this._version;
  }
};

versionService._initializationPromise = versionService._initialize();

export const version = versionService;