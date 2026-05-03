import { addLog } from "./data.js";

/**
 * Send a Telegram message via the Bot API.
 * botToken and chatId are stored in settings (not env secrets).
 * Throws on network or API error — callers should catch and log.
 */
export async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  message: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`);
  }

  addLog("upload", "info", "Telegram notification sent");
}
