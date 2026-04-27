import dotenv from "dotenv";

dotenv.config();

const v = process.env.AI_SDK_LOG_WARNINGS?.trim().toLowerCase();
if (v === "false" || v === "0" || v === "no" || v === "off") {
  globalThis.AI_SDK_LOG_WARNINGS = false;
}
