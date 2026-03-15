import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { getDefaultServicesDir } from "../services/discovery.js";

const SERVICES_BASE_PATH = "/__openclaw__/services";

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".ts":
      return "application/typescript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function setServiceFileHeaders(res: ServerResponse, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", contentTypeForExt(ext));
  res.setHeader("Cache-Control", "no-cache");
}

function isSafePath(servicePath: string, targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  return resolved.startsWith(servicePath);
}

export function handleServicesHttpRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (!pathname.startsWith(SERVICES_BASE_PATH)) {
    return false;
  }

  const relativePath = pathname.slice(SERVICES_BASE_PATH.length).replace(/^\/+/, "");
  if (!relativePath) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Service not specified");
    return true;
  }

  const pathParts = relativePath.split("/");
  const serviceId = pathParts[0];
  const subPath = pathParts.slice(1).join("/") || "index.html";

  const servicesDir = getDefaultServicesDir();
  const serviceDir = path.join(servicesDir, serviceId);
  const fullPath = path.join(serviceDir, "ui", subPath);

  if (!isSafePath(serviceDir, fullPath)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Forbidden");
    return true;
  }

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found");
      return true;
    }

    const content = fs.readFileSync(fullPath);
    setServiceFileHeaders(res, fullPath);
    res.statusCode = 200;
    res.end(content);
    return true;
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return true;
  }
}
