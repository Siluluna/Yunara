import path from "node:path";
import winston from "winston";
import "winston-daily-rotate-file";
import { Yunara_logs_Path } from "#Yunara/utils/path";

const customLevels = {
  levels: {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  },
  colors: {
    fatal: "bold red",
    error: "red",
    warn: "yellow",
    info: "green",
    debug: "blue",
  },
};

winston.addColors(customLevels.colors);

const upperCaseLevel = winston.format(info => {
  info.level = info.level.toUpperCase();
  return info;
});

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  upperCaseLevel(),
  winston.format.colorize(),
  winston.format.printf(info => {
    const { timestamp, level, message, namespace, ...args } = info;

    const GOLD_COLOR = '\u001b[38;5;220m';
    const RESET_COLOR = '\u001b[39m';
    const DARK_RED_COLOR = '\u001b[31m';

    const specialMessages = [
        '------------Yunara------------',
        /^云☁️ 露插件 v[0-9.-rc]+ 初始化成功$/,
        '------------------------------',
        '配置服务初始化完成'
    ];

    const isSpecialMessage = (msg) => {
      for (const special of specialMessages) {
        if (typeof special === 'string' && special === msg) return true;
        if (special instanceof RegExp && special.test(msg)) return true;
      }
      return false;
    };

    const uncoloredLevel = level.replace(/\u001b\[[0-9;]*m/g, '');
    const levelColor = level.substring(0, level.indexOf(uncoloredLevel));

    if (uncoloredLevel === 'FATAL') {
        const timePart = `${DARK_RED_COLOR}[${timestamp}]`;
        const levelPart = `[${level}]`; 
        const namespacePart = namespace ? ` [${namespace}]` : '';
        const extra = Object.keys(args).length ? `\n${JSON.stringify(args, null, 2)}` : '';
        
        return `${timePart}${levelPart}${RESET_COLOR}${namespacePart} ${message}${extra}`;
    }

    const timeAndLevelPart = `${levelColor}[${timestamp}][${uncoloredLevel}]${RESET_COLOR}`;

    let namespacePart = '';
    if (namespace) {
      const parts = namespace.split(':');
      const yunaraPart = `[  ${parts.shift()}  ]`;
      const restOfParts = parts.length > 0 ? ` [${parts.join(':')}]` : '';
      
      const coloredYunaraPart = `${GOLD_COLOR}${yunaraPart}${RESET_COLOR}`;
      namespacePart = coloredYunaraPart + restOfParts;
    }

    const extra = Object.keys(args).length ? `\n${JSON.stringify(args, null, 2)}` : '';

    if (isSpecialMessage(message)) {
      const plainTimeAndLevel = `[${timestamp}][${uncoloredLevel}]`;
      const goldTimeAndLevel = `${GOLD_COLOR}${plainTimeAndLevel}${RESET_COLOR}`;
      const goldMessage = `${GOLD_COLOR}${message}${RESET_COLOR}`;
      
      return `${goldTimeAndLevel}${namespacePart} ${goldMessage}${extra}`;
    } else {
      return `${timeAndLevelPart}${namespacePart} ${message}${extra}`;
    }
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  upperCaseLevel(),
  winston.format.printf(info => {
    const { timestamp, level, message, namespace, ...args } = info;
    const ns = namespace ? `[${namespace}]` : '';
    const extra = Object.keys(args).length ? `\n${JSON.stringify(args, null, 2)}` : '';
    const uncoloredLevel = level.replace(/\u001b\[[0-9;]*m/g, '');
    return `[${timestamp}][${uncoloredLevel}]${ns} ${message}${extra}`;
  })
);


const loggers = new Map();
let isExceptionHandlerRegistered = false;

export function createLogger(namespace) {
  if (loggers.has(namespace)) {
    return loggers.get(namespace);
  }

  const logDirectory = path.join(Yunara_logs_Path, namespace.replace(/:/g, path.sep));

  const loggerOptions = {
    levels: customLevels.levels,
    defaultMeta: { namespace },
    transports: [
      new winston.transports.Console({
        level: "info",
        format: consoleFormat,
      }),
      new winston.transports.DailyRotateFile({
        level: "debug",
        format: fileFormat,
        dirname: logDirectory,
        filename: "runtime-%DATE%.log",
        datePattern: "YYYY-MM-DD",
        zippedArchive: true,
        maxSize: "20m",
        maxFiles: "14d",
      }),
    ],
    exitOnError: false
  };

  if (!isExceptionHandlerRegistered) {
    loggerOptions.exceptionHandlers = [
        new winston.transports.File({
            format: fileFormat,
            dirname: path.join(Yunara_logs_Path, '_exceptions'), 
            filename: 'exceptions.log'
        })
    ];
    loggerOptions.rejectionHandlers = [
        new winston.transports.File({
            format: fileFormat,
            dirname: path.join(Yunara_logs_Path, '_exceptions'), 
            filename: 'rejections.log'
        })
    ];
    isExceptionHandlerRegistered = true;
  }

  const logger = winston.createLogger(loggerOptions);
  loggers.set(namespace, logger);

  return logger;
}