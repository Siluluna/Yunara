import { createLogger } from '#Yunara/utils/Logger';

const logger = createLogger('Yunara:Utils:Role:LayoutCalculator');

class LayoutCalculator {
    /**
     * @private
     * @description 估算一个字符串在前端渲染后的大致像素宽度，加权模型，假设一个 CJK 字符的宽度是基础字号的两倍，而一个 ASCII 字符的宽度约等于基础字号
     * @param {string} text - 要计算的文本
     * @param {object} options - 计算选项
     * @param {number} options.baseFontSize - 基础字号 (px)
     * @param {number} options.cjkWeight - CJK 字符的宽度权重
     * @param {number} options.asciiWeight - ASCII 字符的宽度权重
     * @returns {number} 估算的像素宽度
     */
    #estimateTextWidth(text, options) {
        let width = 0;
        for (const char of text) {
            if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(char)) {
                width += options.baseFontSize * options.cjkWeight;
            } else {
                width += options.baseFontSize * options.asciiWeight;
            }
        }
        return width;
    }

    /**
     * @public
     * @description 核心公共接口。接收一个名字数组，并将其智能分割成二维数组以适应容器宽度
     * @param {string[]} names - 角色名或其他标签的字符串数组
     * @param {object} [options={}] - 布局选项
     * @param {number} [options.maxWidth=450] - 容器的最大像素宽度
     * @param {number} [options.itemSpacing=10] - 每个胶囊之间的水平间距 (px)
     * @param {number} [options.itemPaddingX=20] - 每个胶囊的水平内边距总和 (px)
     * @param {number} [options.baseFontSize=13] - 用于计算宽度的基础字号 (px)
     * @param {number} [options.cjkWeight=1.1] - CJK 字符的宽度权重。
     * @param {number} [options.asciiWeight=0.6] - ASCII 字符的宽度权重。
     * @returns {string[][]} - 分割好的二维数组
     */
    groupNamesIntoLines(names, options = {}) {
        const defaults = {
            maxWidth: 450,
            itemSpacing: 10,
            itemPaddingX: 20,
            baseFontSize: 13,
            cjkWeight: 1.1,
            asciiWeight: 0.6,
        };
        const finalOptions = { ...defaults, ...options };

        if (!Array.isArray(names) || names.length === 0) {
            return [];
        }

        const lines = [];
        let currentLine = [];
        let currentLineWidth = 0;

        for (const name of names) {
            const textWidth = this.#estimateTextWidth(name, finalOptions);
            const itemWidth = textWidth + finalOptions.itemPaddingX;

            const requiredWidth = currentLine.length === 0 
                ? itemWidth 
                : currentLineWidth + finalOptions.itemSpacing + itemWidth;

            if (requiredWidth > finalOptions.maxWidth && currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = [name];
                currentLineWidth = itemWidth;
            } else {
                currentLine.push(name);
                currentLineWidth = requiredWidth;
            }
        }

        if (currentLine.length > 0) {
            lines.push(currentLine);
        }

        logger.debug(`已将 ${names.length} 个项目分组到 ${lines.length} 行中。`);
        return lines;
    }
}

export const layoutCalculator = new LayoutCalculator();