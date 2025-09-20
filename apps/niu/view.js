import plugin from "../../../../lib/plugins/plugin.js"
import { config } from "#Yunara/utils/config"
import { createLogger } from "#Yunara/utils/logger"
import { data } from "#Yunara/utils/data"
import { NiuDataService } from "#Yunara/utils/niu/data"
import { aliasMatcher } from "#Yunara/utils/role/aliasmatcher"
import { file } from "#Yunara/utils/file"
import path from "node:path"
import fs from "node:fs/promises"
import common from "../../../../lib/common/common.js"
import { Yunara_Repos_Path, Yunzai_Path } from "#Yunara/utils/path"

const logger = createLogger("Yunara:Niu:View")

const PRIMARY_TAGS = {
  ai图: "isAiImage",
  ai: "isAiImage",
  r18: "isRx18",
  p18: "isPx18",
  彩蛋: "isEasterEgg",
  横屏: "layout",
}

export class NiuView extends plugin {
  constructor() {
    super({
      name: "咕咕牛图库查看",
      dsc: "查看咕咕牛图库内容",
      event: "message",
      priority: 50,
      rule: [
        {
          reg: /^#?咕咕牛查看\s*(.*)$/i,
          fnc: "View",
        },
      ],
    })
  }

  View = async e => {
    const match = e.msg.match(/^#?咕咕牛查看\s*(.*)$/i)
    const userInput = match && match[1] ? match[1].trim() : ""

    if (!userInput) {
      return this._showSearchHelper(e)
    }

    const allImages = await NiuDataService.getImages()
    if (allImages.length === 0) {
      return e.reply("图库元数据为空，请先下载或更新图库。", true)
    }

    const lowerInput = userInput.toLowerCase()

    if (PRIMARY_TAGS[lowerInput]) {
      return this._handleTagQuery(e, userInput, allImages)
    }

    const secondaryTags = await NiuDataService.getSecondaryTags()
    if (secondaryTags.includes(userInput)) {
      return this._handleSecondaryTagQuery(e, userInput, allImages)
    }

    return this._handleCharacterQuery(e, userInput, allImages)
  }

  async _showSearchHelper(e) {
    return e.reply(
      "请输入要查看的角色名或标签。\n例如：#咕咕牛查看 纳西妲\n或：#咕咕牛查看 AI图",
      true,
    )
  }

  async _handleTagQuery(e, tagName, allImages) {
    const attributeKey = PRIMARY_TAGS[tagName.toLowerCase()]
    const filtered = allImages.filter(img =>
      attributeKey === "layout"
        ? img.attributes.layout === "landscape"
        : img.attributes[attributeKey] === true,
    )
    return this._sendImagesInBatches(e, filtered, `标签 [${tagName}]`)
  }

  async _handleSecondaryTagQuery(e, tagName, allImages) {
    const filtered = allImages.filter(img => img.attributes.secondaryTags?.includes(tagName))
    return this._sendImagesInBatches(e, filtered, `二级标签 [${tagName}]`)
  }

  async _handleCharacterQuery(e, characterName, allImages) {
    const aliasResult = await aliasMatcher.find(characterName)
    if (!aliasResult.success) {
      return e.reply(`图库中没有找到名为「${characterName}」的角色信息。`, true)
    }
    const standardName = aliasResult.name
    const filtered = allImages.filter(img => img.characterName === standardName)
    return this._sendImagesInBatches(e, filtered, `角色 [${standardName}]`, standardName)
  }

  async _sendImagesInBatches(e, images, queryDescription, standardName = null) {
    const settings = (await config.get("niu.settings")) || {}
    const niu_userBans = new Set(await data.get("niu_userBans", []))

    const allowedImages = images.filter(image => image.isAllowed(settings, niu_userBans))

    if (allowedImages.length === 0) {
      return e.reply(`没有找到符合 ${queryDescription} 条件且允许显示的图片。`, true)
    }

    allowedImages.sort((a, b) => {
      const numA = parseInt(a.path.match(/Gu(\d+)\.webp$/i)?.[1] || "0")
      const numB = parseInt(b.path.match(/Gu(\d+)\.webp$/i)?.[1] || "0")
      return numA - numB
    })

    const BATCH_SIZE = 28
    const totalItems = allowedImages.length
    const totalBatches = Math.ceil(totalItems / BATCH_SIZE)
    await e.reply(
      `为 ${queryDescription} 找到 ${totalItems} 张图片，将分 ${totalBatches} 批发送...`,
      true,
    )

    const gameKey = allowedImages[0]?.sourceGallery?.split("-")[0] || null

    for (let i = 0; i < totalBatches; i++) {
      const batchNum = i + 1
      const startIndex = i * BATCH_SIZE
      const currentBatchData = allowedImages.slice(startIndex, startIndex + BATCH_SIZE)

      const forwardMsg = await this._buildForwardMsg(e, {
        batchData: currentBatchData,
        standardName: standardName || queryDescription,
        gameKey: gameKey,
        batchNum: batchNum,
        totalBatches: totalBatches,
        startIndex: startIndex,
        totalItems: totalItems,
      })

      if (forwardMsg) {
        await e.reply(forwardMsg)
        await common.sleep(1000)
      }
    }
    return true
  }

  async _buildForwardMsg(e, options) {
    const { batchData, standardName, gameKey, batchNum, totalBatches, startIndex, totalItems } =
      options

    const titleFaceUrl = await this._getCharacterFaceUrl(standardName, gameKey)

    const makeForwardMsgTitle = titleFaceUrl
      ? [segment.image(titleFaceUrl), ` [${standardName}] 图库详情 (${batchNum}/${totalBatches})`]
      : `[${standardName}] 图库详情 (${batchNum}/${totalBatches})`

    const forwardList = []

    const firstNodeText =
      batchNum === 1
        ? `查看『${standardName}』 (${startIndex + 1}-${Math.min(startIndex + batchData.length, totalItems)} / ${totalItems} 张)\n想导出图片？试试: #咕咕牛导出${standardName}1`
        : `查看『${standardName}』(续) (${startIndex + 1}-${Math.min(startIndex + batchData.length, totalItems)} / ${totalItems} 张)`
    forwardList.push(firstNodeText)

    for (const [index, image] of batchData.entries()) {
      const absolutePath = await this._findImageAbsolutePath(image)
      const messageNode = []

      if (absolutePath) {
        messageNode.push(segment.image(`file://${absolutePath}`))
      } else {
        messageNode.push(`[图片文件丢失: ${path.basename(image.path)}]`)
      }

      const textInfoLines = []
      textInfoLines.push(`${startIndex + index + 1}. ${path.basename(image.path)}`)

      const tags = []
      if (image.attributes.isRx18) tags.push("R18")
      if (image.attributes.isPx18) tags.push("P18")
      if (image.attributes.isAiImage) tags.push("AI")
      if (tags.length > 0) textInfoLines.push(`Tag：${tags.join(" / ")}`)

      let fileSizeFormatted = ""
      if (absolutePath) {
        try {
          const stats = await fs.stat(absolutePath)
          fileSizeFormatted = file.formatBytes(stats.size)
        } catch (statErr) {
          /* 获取失败就算了 */
        }
      }
      if (fileSizeFormatted) textInfoLines.push(`占用：${fileSizeFormatted}`)

      messageNode.push(textInfoLines.join("\n"))
      forwardList.push(messageNode)
    }

    if (forwardList.length > 1) {
      return common.makeForwardMsg(e, forwardList, makeForwardMsgTitle)
    }
    return null
  }

  async _findImageAbsolutePath(image) {
    if (!image.storagebox || !image.path) return null
    const potentialPath = path.join(Yunara_Repos_Path, image.storagebox, image.path)
    return (await file.exists(potentialPath)) ? potentialPath : null
  }

  async _getCharacterFaceUrl(characterName, gameKey) {
    if (!characterName || !gameKey) return null

    const exPlugins = await config.get("externalPlugins", {})

    try {
      switch (gameKey) {
        case "gs":
        case "sr": {
          const basePath =
            gameKey === "gs" ? exPlugins.miao?.gsAliasDir : exPlugins.miao?.srAliasDir
          if (!basePath) return null

          const fullBasePath = path.join(Yunzai_Path, basePath, characterName, "imgs")

          // 优先检查皮肤头像 face2.webp
          const skinFacePath = path.join(fullBasePath, "face2.webp")
          if (await file.exists(skinFacePath)) return `file://${skinFacePath.replace(/\\/g, "/")}`

          // 回退到默认头像 face.webp
          const normalFacePath = path.join(fullBasePath, "face.webp")
          if (await file.exists(normalFacePath))
            return `file://${normalFacePath.replace(/\\/g, "/")}`

          break
        }
        case "zzz": {
          const dataDir = exPlugins.zzz?.dataDir
          const faceDir = exPlugins.zzz?.faceDir
          if (!dataDir || !faceDir) return null

          const files = await fs.readdir(path.join(Yunzai_Path, dataDir))
          for (const file of files) {
            if (file.endsWith(".json")) {
              const data = JSON.parse(
                await fs.readFile(path.join(Yunzai_Path, dataDir, file), "utf-8"),
              )
              if (data.Name === characterName || data.CodeName === characterName) {
                const iconMatch = data.Icon?.match(/\d+$/)
                if (iconMatch) {
                  const facePath = path.join(
                    Yunzai_Path,
                    faceDir,
                    `IconRoleCircle${iconMatch[0]}.png`,
                  )
                  if (await file.exists(facePath)) return `file://${facePath.replace(/\\/g, "/")}`
                }
                break
              }
            }
          }
          break
        }
        // case 'waves':
        //   // 鸣潮的头像逻辑待补充
        //   break;
      }
    } catch (error) {
      logger.debug(`查找角色 [${characterName}] 头像失败:`, error.message)
      return null
    }
    return null
  }
}
