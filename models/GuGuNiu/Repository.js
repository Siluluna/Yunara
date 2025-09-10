// 文件路径: /plugins/Yunara/models/GuGuNiu/Repository.js

import path from 'node:path'
import fs from 'node:fs/promises'
import { git } from '#Yunara/utils/Git'
import { config } from '#Yunara/utils/Config'
import { createLogger } from '#Yunara/utils/Logger'
import { Yunara_Repos_Path } from '#Yunara/utils/Path'
import { GuGuNiuImage } from './Image.js'

const logger = createLogger('Yunara:Model:GuGuNiuRepo')

/**
 * @class GuGuNiuRepository
 * @description 代表一个在 Gallery.yaml 中配置的咕咕牛 Git 仓库
 * 封装了下载、更新、加载图片数据等核心业务行为
 */
export class GuGuNiuRepository {
  /**
   * @param {object} repoConfig 来自 Gallery.yaml 的单条仓库配置
   */
  constructor(repoConfig) {
    /** @type {string} 仓库的唯一标识符 */
    this.id = repoConfig.id

    /** @type {string} 仓库的 Git URL */
    this.url = repoConfig.url

    /** @type {string} 仓库的分支 */
    this.branch = repoConfig.branch

    /** @type {string} 仓库的描述性名称 */
    this.description = repoConfig.description

    /** @type {boolean} 是否为核心仓库 (包含 ImageData.json) */
    this.isCore = repoConfig.isCore === true

    /** @type {boolean} 是否包含可选的游戏内容 (如 ZZZ, Waves) */
    this.containsOptionalContent = repoConfig.containsOptionalContent === true

    /** @type {string} 仓库的本地存储目录名 */
    this.name = path.basename(new URL(this.url).pathname, '.git')

    /** @type {string} 仓库在本地磁盘上的绝对路径 */
    this.localPath = path.join(Yunara_Repos_Path, this.name)
  }

  /**
   * @public
   * @description [核心静态入口] 从配置中获取所有仓库并实例化为 Repository 对象数组
   * @returns {Promise<GuGuNiuRepository[]>}
   */
  static async getAll() {
    const galleryConfig = await config.get('guguniu.gallery')
    if (!galleryConfig || !Array.isArray(galleryConfig.repositories)) {
      logger.warn('Gallery.yaml 配置缺失或格式不正确，无法加载仓库列表')
      return []
    }
    return galleryConfig.repositories.map(cfg => new GuGuNiuRepository(cfg))
  }

  /**
   * @public
   * @description [新增] 获取唯一的“核心”仓库实例
   * @returns {Promise<GuGuNiuRepository|null>}
   */
  static async getCoreRepository() {
    const allRepos = await this.getAll()
    return allRepos.find(repo => repo.isCore) || null
  }

  /**
   * @public
   * @description [新增] 获取所有已下载的仓库实例
   * @returns {Promise<GuGuNiuRepository[]>}
   */
  static async getDownloaded() {
    const allRepos = await this.getAll()
    const existenceChecks = await Promise.all(allRepos.map(repo => repo.isDownloaded()))
    return allRepos.filter((_, index) => existenceChecks[index])
  }

  /**
   * @public
   * @description 检查此仓库是否已下载到本地
   * @returns {Promise<boolean>}
   */
  async isDownloaded() {
    return git.isRepoDownloaded(this.localPath)
  }

  /**
   * @public
   * @description 执行下载（克隆）此仓库的业务操作
   * @param {object} [callbacks={}] 可选的回调函数，用于进度报告
   * @returns {Promise<object>} 返回 git.cloneRepo 的结果对象
   */
  async download(callbacks = {}) {
    logger.info(`[${this.description}] 开始执行下载任务...`)
    const result = await git.cloneRepo({
      repoUrl: this.url,
      localPath: this.localPath,
      branch: this.branch,
      callbacks: callbacks,
    })
    // 将模型自身的信息附加到结果上，方便上层使用
    return { ...result, ...this }
  }

  /**
   * @public
   * @description 执行更新此仓库的业务操作
   * @returns {Promise<object>} 返回 git.updateRepo 的结果对象
   */
  async update() {
    logger.info(`[${this.description}] 开始执行更新任务...`)
    const result = await git.updateRepo({
      localPath: this.localPath,
      branch: this.branch,
      repoUrl: this.url,
    })
    // 将模型自身的信息附加到结果上，方便上层使用
    return { ...result, ...this }
  }

  /**
   * @public
   * @description 加载并解析本仓库的 ImageData.json 文件，返回 GuGuNiuImage 实例数组
   * @returns {Promise<GuGuNiuImage[]>}
   */
  async loadImages() {
    if (!this.isCore) {
        return []
    }
    const imageDataPath = path.join(this.localPath, 'ImageData.json')
    try {
      const content = await fs.readFile(imageDataPath, 'utf-8')
      const rawData = JSON.parse(content)

      if (!Array.isArray(rawData)) {
        logger.error(`[${this.description}] 的 ImageData.json 内容不是一个有效的数组`)
        return []
      }

      return rawData
        .filter(item => item && typeof item.path === 'string')
        .map(item => new GuGuNiuImage(item))
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.error(`核心仓库 [${this.description}] 未找到关键的 ImageData.json 文件！`)
      } else {
        logger.error(`[${this.description}] 加载或解析 ImageData.json 失败:`, error)
      }
      return []
    }
  }
}