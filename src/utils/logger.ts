import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { NextFunction, Request, Response } from "express";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const LOG_DIRECTORY = path.join(process.cwd(), "logs");
const DEFAULT_LOG_FILE = "app.log";

const ensureLogDirectory = () => {
    fs.mkdirSync(LOG_DIRECTORY, { recursive: true });
};

const stringifyMeta = (meta?: unknown) => {
    if (meta === undefined) {
        return "";
    }

    if (meta instanceof Error) {
        return JSON.stringify({
            name: meta.name,
            message: meta.message,
            stack: meta.stack,
        });
    }

    if (typeof meta === "string") {
        return meta;
    }

    try {
        return JSON.stringify(meta);
    } catch (error) {
        return util.inspect(meta, { depth: 6, breakLength: Infinity });
    }
};

const writeLog = (
    level: LogLevel,
    scope: string,
    message: string,
    meta?: unknown,
    fileName: string = DEFAULT_LOG_FILE
) => {
    ensureLogDirectory();

    const timestamp = new Date().toISOString();
    const suffix = meta === undefined ? "" : ` ${stringifyMeta(meta)}`;
    const line = `${timestamp} ${level} [${scope}] ${message}${suffix}`;

    if (level === "ERROR") {
        console.error(line);
    } else if (level === "WARN") {
        console.warn(line);
    } else {
        console.log(line);
    }

    fs.appendFileSync(path.join(LOG_DIRECTORY, fileName), `${line}\n`);
};

export const createLogger = (scope: string, fileName: string = DEFAULT_LOG_FILE) => ({
    info: (message: string, meta?: unknown) => writeLog("INFO", scope, message, meta, fileName),
    warn: (message: string, meta?: unknown) => writeLog("WARN", scope, message, meta, fileName),
    error: (message: string, meta?: unknown) => writeLog("ERROR", scope, message, meta, fileName),
    debug: (message: string, meta?: unknown) => writeLog("DEBUG", scope, message, meta, fileName),
});

export const logger = createLogger("app");
const httpLogger = createLogger("http", "requests.log");

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    httpLogger.info("Incoming request", {
        method: req.method,
        path: req.originalUrl,
        query: req.query,
    });

    res.on("finish", () => {
        httpLogger.info("Request completed", {
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
        });
    });

    next();
};
