// file: src/config/multer.config.ts

import multer from "multer";

const storage = multer.memoryStorage();

// File filter
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  cb(null, true);
};

// Multer config
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

export default upload;
