import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { randomUUID } from "node:crypto";

const uploadDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  }
});

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  const allowedExt = [".xlsx", ".csv", ".pdf"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExt.includes(ext)) {
    cb(new Error("Unsupported file type. Allowed: .xlsx, .csv, .pdf"));
    return;
  }
  cb(null, true);
}

export const uploadMiddleware = multer({ storage, fileFilter });
