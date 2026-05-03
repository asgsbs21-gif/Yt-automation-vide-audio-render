import { useEffect, useRef, useCallback } from "react";

export type ThumbBgColor = "yellow" | "green" | "red";

interface ThumbnailCanvasProps {
  thumbnailUrl: string;
  title: string;
  bgColor: ThumbBgColor;
  onDataUrl?: (dataUrl: string) => void;
  className?: string;
}

const BG_COLORS: Record<ThumbBgColor, string> = {
  yellow: "#FACC15",
  green:  "#22C55E",
  red:    "#EF4444",
};

const CANVAS_W = 1080;
const CANVAS_H = 1920;

function wrapBengaliText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function ThumbnailCanvas({
  thumbnailUrl,
  title,
  bgColor,
  onDataUrl,
  className,
}: ThumbnailCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    await document.fonts.ready;

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // ── Background frame ────────────────────────────────────────────────────
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);

      // ── Colour box in top 28% of frame ─────────────────────────────────────
      const boxPadX    = 48;
      const boxTop     = 60;
      const boxW       = CANVAS_W - boxPadX * 2;
      const fontSize   = 88;
      const lineHeight = fontSize * 1.25;
      const textPadX   = 56;
      const textPadY   = 52;

      const font = `bold ${fontSize}px "Hind Siliguri", "Noto Sans Bengali", sans-serif`;
      ctx.font = font;

      const lines = wrapBengaliText(ctx, title || "শিরোনাম", boxW - textPadX * 2);
      const boxH = lines.length * lineHeight + textPadY * 2;

      // Rounded rectangle
      const radius = 28;
      ctx.beginPath();
      ctx.moveTo(boxPadX + radius, boxTop);
      ctx.lineTo(boxPadX + boxW - radius, boxTop);
      ctx.quadraticCurveTo(boxPadX + boxW, boxTop, boxPadX + boxW, boxTop + radius);
      ctx.lineTo(boxPadX + boxW, boxTop + boxH - radius);
      ctx.quadraticCurveTo(boxPadX + boxW, boxTop + boxH, boxPadX + boxW - radius, boxTop + boxH);
      ctx.lineTo(boxPadX + radius, boxTop + boxH);
      ctx.quadraticCurveTo(boxPadX, boxTop + boxH, boxPadX, boxTop + boxH - radius);
      ctx.lineTo(boxPadX, boxTop + radius);
      ctx.quadraticCurveTo(boxPadX, boxTop, boxPadX + radius, boxTop);
      ctx.closePath();

      // Semi-transparent overlay under box for contrast
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fill();
      ctx.fillStyle = BG_COLORS[bgColor];
      ctx.globalAlpha = 0.88;
      ctx.fill();
      ctx.globalAlpha = 1;

      // ── Text rendering ──────────────────────────────────────────────────────
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const textX = boxPadX + boxW / 2;
      let textY   = boxTop + textPadY;

      for (const line of lines) {
        // Black stroke for readability on any background
        ctx.lineWidth = 8;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(line, textX, textY);
        // White fill
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(line, textX, textY);
        textY += lineHeight;
      }

      onDataUrl?.(canvas.toDataURL("image/jpeg", 0.92));
    };

    img.onerror = () => {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      onDataUrl?.(canvas.toDataURL("image/jpeg", 0.92));
    };

    img.src = thumbnailUrl;
  }, [thumbnailUrl, title, bgColor, onDataUrl]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className={className}
      style={{ width: "100%", height: "auto", display: "block" }}
    />
  );
}
