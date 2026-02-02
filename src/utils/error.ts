export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
  }
  return String(error);
}

export function formatError(error: unknown): string {
  let message = getErrorMessage(error).trim();
  if (!message) return "未知错误";

  message = message.replace(/^Error:\s*/i, "");
  message = message.replace(/^InvokeError:\s*/i, "");
  message = message.replace(/^Task join error:\s*/i, "");

  const lower = message.toLowerCase();
  if (lower.includes("os error 13") || lower.includes("permission denied")) {
    return "权限不足：请检查文件/文件夹访问权限，或选择其他位置。";
  }
  if (lower.includes("os error 2") || lower.includes("no such file or directory")) {
    return "文件或目录不存在：请检查路径是否正确。";
  }
  if (lower.includes("os error 28") || lower.includes("no space left on device")) {
    return "磁盘空间不足：请释放空间后重试。";
  }

  return message;
}

