"use client"

import type React from "react"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { X, Paintbrush, Eraser, Undo, Redo, Download, Square, Circle, Type } from "lucide-react"

interface CanvasEditorProps {
  image: string
  onSave: (editedImageUrl: string) => void
  onClose: () => void
}

export type CanvasEditorHandle = {
  getMaskBlob: (options?: { type?: string; quality?: number }) => Promise<Blob>
  getModifiedBlob: (options?: { type?: string; quality?: number }) => Promise<Blob>
}

type Tool = "pen" | "eraser" | "rectangle" | "ellipse" | "text"

type Point = { x: number; y: number }

type BaseStroke = {
  tool: Tool
  color: string
  lineWidth: number
  isMask: boolean
}

type FreehandStroke = BaseStroke & {
  tool: "pen" | "eraser"
  points: Point[]
}

type RectStroke = BaseStroke & {
  tool: "rectangle"
  start: Point
  end: Point
  fill?: boolean
  text?: string
}

type EllipseStroke = BaseStroke & {
  tool: "ellipse"
  start: Point
  end: Point
  fill?: boolean
  text?: string
}

type Stroke = FreehandStroke | RectStroke | EllipseStroke

type TextStroke = BaseStroke & {
  tool: "text"
  position: Point
  text: string
  fontSize: number
}

type AnyStroke = Stroke | TextStroke

const DEFAULT_COLORS = ["#000000", "#ffffff", "#ff3b30", "#34c759", "#0a84ff", "#ff9f0a", "#bf5af2", "#ff2d55"]

const getDPR = () => (typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1)

const CanvasEditor = forwardRef<CanvasEditorHandle, CanvasEditorProps>(({ image, onSave, onClose }, ref) => {
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState<string>(DEFAULT_COLORS[0])
  const [lineWidth, setLineWidth] = useState<number>(8)
  const [strokes, setStrokes] = useState<AnyStroke[]>([])
  const [redoStack, setRedoStack] = useState<AnyStroke[]>([])
  const [isDrawing, setIsDrawing] = useState<boolean>(false)
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null)
  const [shapeFill, setShapeFill] = useState<boolean>(true)

  const [textOverlay, setTextOverlay] = useState<{
    active: boolean
    value: string
    cssX: number
    cssY: number
    mode: "text" | "shape"
    targetIndex: number | null
    naturalPos?: Point
  }>({ active: false, value: "", cssX: 0, cssY: 0, mode: "text", targetIndex: null })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorAreaRef = useRef<HTMLDivElement>(null)

  const naturalSize = useMemo(() => {
    const img = imageRef.current
    if (!img) return { width: 1, height: 1 }
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height }
  }, [image])

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = getDPR()
    const natW = img.naturalWidth || img.width
    const natH = img.naturalHeight || img.height
    // Compute displayed size that fully contains the image within the editor area
    const host = editorAreaRef.current || canvas.parentElement || document.body
    const hostRect = host.getBoundingClientRect()
    const availW = Math.max(1, hostRect.width)
    const availH = Math.max(1, hostRect.height)
    const scale = Math.min(availW / natW, availH / natH)
    const dispW = Math.max(1, Math.floor(natW * scale))
    const dispH = Math.max(1, Math.floor(natH * scale))

    canvas.width = Math.max(1, Math.floor(dispW * dpr))
    canvas.height = Math.max(1, Math.floor(dispH * dpr))
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    canvas.style.width = `${dispW}px`
    canvas.style.height = `${dispH}px`
    if (containerRef.current) {
      containerRef.current.style.width = `${dispW}px`
      containerRef.current.style.height = `${dispH}px`
    }
    // Ensure the image element matches the displayed size
    img.style.width = `${dispW}px`
    img.style.height = `${dispH}px`
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    redraw()
  }, [])

  useEffect(() => {
    const img = imageRef.current
    if (!img) return
    const obs = new ResizeObserver(() => setupCanvas())
    obs.observe(img)
    const onResize = () => setupCanvas()
    window.addEventListener("resize", onResize)
    return () => {
      obs.disconnect()
      window.removeEventListener("resize", onResize)
    }
  }, [setupCanvas])

  const clientToNatural = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const natW = img.naturalWidth || img.width
    const natH = img.naturalHeight || img.height
    const relX = e.clientX - rect.left
    const relY = e.clientY - rect.top
    const x = (relX / rect.width) * natW
    const y = (relY / rect.height) * natH
    return { x, y }
  }

  const naturalToCss = (nat: { x: number; y: number }) => {
    const img = imageRef.current
    if (!img) return { x: 0, y: 0 }
    const rect = img.getBoundingClientRect()
    const natW = img.naturalWidth || img.width
    const natH = img.naturalHeight || img.height
    const x = (nat.x / natW) * rect.width
    const y = (nat.y / natH) * rect.height
    return { x, y }
  }

  const drawStrokeOnCtx = (ctx: CanvasRenderingContext2D, stroke: AnyStroke, coordSpace: "css" | "natural") => {
    ctx.save()
    if (stroke.tool !== "text") {
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.lineWidth
      ctx.beginPath()
    }
    const mapPoint = (p: Point): Point => (coordSpace === "css" ? naturalToCss(p) : p)

    if (stroke.tool === "pen" || stroke.tool === "eraser") {
      const points = stroke.points
      if (points.length === 1) {
        const p = mapPoint(points[0])
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x + 0.01, p.y + 0.01) // tiny line to render a dot
      } else if (points.length > 1) {
        const p0 = mapPoint(points[0])
        ctx.moveTo(p0.x, p0.y)
        for (let i = 1; i < points.length; i++) {
          const p = mapPoint(points[i])
          ctx.lineTo(p.x, p.y)
        }
      }
      ctx.stroke()
    } else if (stroke.tool === "rectangle") {
      const s = mapPoint(stroke.start)
      const e = mapPoint(stroke.end)
      const x = Math.min(s.x, e.x)
      const y = Math.min(s.y, e.y)
      const w = Math.abs(e.x - s.x)
      const h = Math.abs(e.y - s.y)
      if (stroke.fill) {
        ctx.save()
        ctx.globalAlpha = coordSpace === "natural" ? 0.5 : 0.5
        ctx.fillStyle = "#000000"
        ctx.fillRect(x, y, w, h)
        ctx.restore()
      }
      ctx.strokeRect(x, y, w, h)
      if (stroke.text) {
        const cx = x + w / 2
        const cy = y + h / 2
        ctx.save()
        const fontSize = Math.max(12, Math.min(w, h) * 0.18)
        ctx.font = `${fontSize}px Arial`
        ctx.fillStyle = "#ffffff"
        ctx.textBaseline = "middle"
        ctx.textAlign = "center"
        ctx.fillText(stroke.text, cx, cy)
        ctx.restore()
      }
    } else if (stroke.tool === "ellipse") {
      const s = mapPoint(stroke.start)
      const e = mapPoint(stroke.end)
      const cx = (s.x + e.x) / 2
      const cy = (s.y + e.y) / 2
      const rx = Math.abs(e.x - s.x) / 2
      const ry = Math.abs(e.y - s.y) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, Math.PI * 2)
      if ((stroke as EllipseStroke).fill) {
        ctx.save()
        ctx.globalAlpha = coordSpace === "natural" ? 0.5 : 0.5
        ctx.fillStyle = "#000000"
        ctx.fill()
        ctx.restore()
      }
      ctx.stroke()
      if ((stroke as EllipseStroke).text) {
        ctx.save()
        const fontSize = Math.max(12, Math.min(rx, ry) * 0.6)
        ctx.font = `${fontSize}px Arial`
        ctx.fillStyle = "#ffffff"
        ctx.textBaseline = "middle"
        ctx.textAlign = "center"
        ctx.fillText((stroke as EllipseStroke).text || "", cx, cy)
        ctx.restore()
      }
    } else if (stroke.tool === "text") {
      const pos = mapPoint(stroke.position)
      ctx.save()
      ctx.font = `${stroke.fontSize}px Arial`
      ctx.fillStyle = stroke.color
      ctx.textBaseline = "top"
      ctx.fillText(stroke.text, pos.x, pos.y)
      ctx.restore()
    }
    ctx.restore()
  }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // canvas is scaled to CSS coordinates (by DPR), so draw using CSS space
    ctx.save()
    const dpr = getDPR()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    for (const s of strokes) drawStrokeOnCtx(ctx, s, "css")
    if (draftStroke) drawStrokeOnCtx(ctx, draftStroke, "css")
    ctx.restore()
  }, [strokes, draftStroke])

  useEffect(() => {
    redraw()
  }, [redraw])

  const beginPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const p = clientToNatural(e)
    setIsDrawing(true)
    if (tool === "pen" || tool === "eraser") {
      const s: FreehandStroke = {
        tool,
        color,
        lineWidth,
        isMask: tool === "eraser",
        points: [p],
      }
      setDraftStroke(s)
    } else if (tool === "rectangle") {
      const s: RectStroke = { tool: "rectangle", color, lineWidth, isMask: false, start: p, end: p, fill: shapeFill }
      setDraftStroke(s)
    } else if (tool === "ellipse") {
      const s: EllipseStroke = { tool: "ellipse", color, lineWidth, isMask: false, start: p, end: p, fill: shapeFill }
      setDraftStroke(s)
    } else if (tool === "text") {
      const css = naturalToCss(p)
      setTextOverlay({ active: true, value: "", cssX: css.x, cssY: css.y, mode: "text", targetIndex: null, naturalPos: p })
    }
  }

  const movePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !draftStroke) return
    const p = clientToNatural(e)
    setDraftStroke((prev) => {
      if (!prev) return prev
      if (prev.tool === "pen" || prev.tool === "eraser") {
        const updated: FreehandStroke = { ...prev, points: [...prev.points, p] }
        return updated
      } else if (prev.tool === "rectangle" || prev.tool === "ellipse") {
        return { ...prev, end: p } as Stroke
      }
      return prev
    })
  }

  const endPointer = () => {
    if (!isDrawing || !draftStroke) return
    setIsDrawing(false)
    if (draftStroke.tool === "rectangle" || draftStroke.tool === "ellipse") {
      const s = draftStroke
      const centerNat: Point = { x: (s.start.x + s.end.x) / 2, y: (s.start.y + s.end.y) / 2 }
      const centerCss = naturalToCss(centerNat)
      setStrokes((prev) => {
        const index = prev.length
        const next = [...prev, s]
        setTextOverlay({ active: true, value: "", cssX: centerCss.x, cssY: centerCss.y, mode: "shape", targetIndex: index })
        return next
      })
    } else {
      setStrokes((prev) => [...prev, draftStroke])
    }
    setRedoStack([])
    setDraftStroke(null)
  }

  const undo = () => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev
      const next = prev.slice(0, prev.length - 1)
      const popped = prev[prev.length - 1]
      setRedoStack((r) => [...r, popped])
      return next
    })
  }

  const redo = () => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev
      const nextRedo = prev.slice(0, prev.length - 1)
      const popped = prev[prev.length - 1]
      setStrokes((s) => [...s, popped])
      return nextRedo
    })
  }

  const drawMaskToCanvas = (maskCanvas: HTMLCanvasElement) => {
    const img = imageRef.current
    if (!img) return
    const natW = img.naturalWidth || img.width
    const natH = img.naturalHeight || img.height
    maskCanvas.width = natW
    maskCanvas.height = natH
    const mctx = maskCanvas.getContext("2d")
    if (!mctx) return
    // white background
    mctx.save()
    mctx.setTransform(1, 0, 0, 1, 0, 0)
    mctx.fillStyle = "#ffffff"
    mctx.fillRect(0, 0, natW, natH)
    // draw all mask strokes in black
    for (const s of strokes) {
      if (!s.isMask) continue
      mctx.strokeStyle = "#000000"
      mctx.lineWidth = s.lineWidth
      mctx.lineCap = "round"
      mctx.lineJoin = "round"
      if (s.tool === "pen" || s.tool === "eraser") {
        const pts = s.points
        mctx.beginPath()
        if (pts.length === 1) {
          const p = pts[0]
          mctx.moveTo(p.x, p.y)
          mctx.lineTo(p.x + 0.01, p.y + 0.01)
        } else if (pts.length > 1) {
          mctx.moveTo(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length; i++) {
            mctx.lineTo(pts[i].x, pts[i].y)
          }
        }
        mctx.stroke()
      } else if (s.tool === "rectangle") {
        const x = Math.min(s.start.x, s.end.x)
        const y = Math.min(s.start.y, s.end.y)
        const w = Math.abs(s.end.x - s.start.x)
        const h = Math.abs(s.end.y - s.start.y)
        if (s.fill) {
          mctx.fillStyle = "#000000"
          mctx.fillRect(x, y, w, h)
        }
        mctx.strokeRect(x, y, w, h)
      } else if (s.tool === "ellipse") {
        const cx = (s.start.x + s.end.x) / 2
        const cy = (s.start.y + s.end.y) / 2
        const rx = Math.abs(s.end.x - s.start.x) / 2
        const ry = Math.abs(s.end.y - s.start.y) / 2
        mctx.beginPath()
        mctx.ellipse(cx, cy, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, Math.PI * 2)
        if (s.fill) {
          mctx.fillStyle = "#000000"
          mctx.fill()
        }
        mctx.stroke()
      }
    }
    mctx.restore()
  }

  const thresholdMask = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = imgData.data
    for (let i = 0; i < d.length; i += 4) {
      // compute luminance to decide black or white
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      const v = lum < 128 ? 0 : 255
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v
      d[i + 3] = 255
    }
    ctx.putImageData(imgData, 0, 0)
  }

  const canvasToBlob = (c: HTMLCanvasElement, options?: { type?: string; quality?: number }) => {
    const type = options?.type || "image/png"
    const quality = options?.quality
    return new Promise<Blob>((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality)
    })
  }

  useImperativeHandle(
    ref,
    () => ({
      async getMaskBlob(options) {
        const maskCanvas = document.createElement("canvas")
        drawMaskToCanvas(maskCanvas)
        thresholdMask(maskCanvas)
        return canvasToBlob(maskCanvas, options)
      },
      async getModifiedBlob(options) {
        const img = imageRef.current
        if (!img) throw new Error("Image not loaded")
        const natW = img.naturalWidth || img.width
        const natH = img.naturalHeight || img.height
        const out = document.createElement("canvas")
        out.width = natW
        out.height = natH
        const octx = out.getContext("2d")
        if (!octx) throw new Error("2d context unavailable")
        // base image
        octx.drawImage(img, 0, 0, natW, natH)
        // build mask
        const maskCanvas = document.createElement("canvas")
        drawMaskToCanvas(maskCanvas)
        thresholdMask(maskCanvas)
        // apply mask: black out masked pixels
        const baseData = octx.getImageData(0, 0, natW, natH)
        const maskCtx = maskCanvas.getContext("2d")
        if (!maskCtx) throw new Error("mask ctx unavailable")
        const maskData = maskCtx.getImageData(0, 0, natW, natH)
        const bd = baseData.data
        const md = maskData.data
        for (let i = 0; i < bd.length; i += 4) {
          // mask pixel black => md[i] == 0 (since thresholded)
          const masked = md[i] < 128
          if (masked) {
            bd[i] = 0
            bd[i + 1] = 0
            bd[i + 2] = 0
            bd[i + 3] = 255
          }
        }
        octx.putImageData(baseData, 0, 0)
        return canvasToBlob(out, options)
      },
    }),
    [strokes]
  )

  const handleSave = () => {
    try {
      const img = imageRef.current
      if (!img) {
        onSave(image)
        return
      }
      const natW = img.naturalWidth || img.width
      const natH = img.naturalHeight || img.height
      const composite = document.createElement("canvas")
      composite.width = natW
      composite.height = natH
      const cctx = composite.getContext("2d")
      if (!cctx) return
      // draw base image, then colored strokes for visual composite
      cctx.drawImage(img, 0, 0, natW, natH)
      for (const s of strokes) drawStrokeOnCtx(cctx, s, "natural")
      if (draftStroke) drawStrokeOnCtx(cctx, draftStroke, "natural")
      const url = composite.toDataURL("image/png")
      onSave(url)
    } catch (err) {
      console.error("Save error:", err)
      onClose()
    }
  }

  const canUndo = strokes.length > 0
  const canRedo = redoStack.length > 0

  return (
    <div className="fixed inset-0 bg-white z-50 flex">
      <div className="w-16 bg-[#a7c19c] flex flex-col items-center py-4 space-y-4">
        <Button
          variant={tool === "pen" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTool("pen")}
          className="w-10 h-10 p-0"
        >
          <Paintbrush className="w-5 h-5" />
        </Button>
        <Button
          variant={tool === "eraser" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTool("eraser")}
          className="w-10 h-10 p-0"
        >
          <Eraser className="w-5 h-5" />
        </Button>
        <Button
          variant={tool === "text" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTool("text")}
          className="w-10 h-10 p-0"
        >
          <Type className="w-5 h-5" />
        </Button>
        <Button
          variant={tool === "rectangle" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTool("rectangle")}
          className="w-10 h-10 p-0"
        >
          <Square className="w-5 h-5" />
        </Button>
        <Button
          variant={tool === "ellipse" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTool("ellipse")}
          className="w-10 h-10 p-0"
        >
          <Circle className="w-5 h-5" />
        </Button>

        <div className="w-10 h-px bg-black/20 my-1" />

        <div className="px-2 w-full">
          <Slider
            min={1}
            max={40}
            value={[lineWidth]}
            onValueChange={(v) => setLineWidth(Array.isArray(v) ? v[0] : lineWidth)}
            className="h-24 data-[orientation=vertical]:h-24"
            orientation="vertical"
          />
        </div>

        <div className="w-12 grid grid-cols-2 gap-1 px-1">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border ${color === c ? "ring-2 ring-black" : ""}`}
              style={{ backgroundColor: c }}
              aria-label={`color-${c}`}
            />
          ))}
        </div>

        <div className="relative w-10 h-10 rounded-full overflow-hidden border">
          <div className="absolute inset-0" style={{ backgroundColor: color }} />
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="custom-color"
          />
        </div>

        <div className="w-10 h-px bg-black/20 my-1" />

        <div className="flex flex-col items-center gap-1 px-1 text-[10px] text-gray-700">
          <span>Fill</span>
          <Switch checked={shapeFill} onCheckedChange={setShapeFill} />
        </div>

        <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo} className="w-10 h-10 p-0">
          <Undo className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={redo} disabled={!canRedo} className="w-10 h-10 p-0">
          <Redo className="w-5 h-5" />
        </Button>
      </div>

      <div ref={editorAreaRef} className="flex-1 relative flex items-center justify-center">
        <Button onClick={onClose} className="absolute top-4 right-4 z-20" variant="ghost" size="sm">
          <X className="w-6 h-6 text-black" />
        </Button>

        <div ref={containerRef} className="relative max-w-full max-h-full">
          <img
            ref={imageRef}
            src={image || "/placeholder.svg"}
            alt="Canvas editor"
            className="select-none"
            onLoad={setupCanvas}
            crossOrigin="anonymous"
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 cursor-crosshair touch-none"
            onPointerDown={beginPointer}
            onPointerMove={movePointer}
            onPointerUp={endPointer}
            onPointerLeave={endPointer}
          />
          {textOverlay.active && (
            <div
              className="absolute bg-white p-2 rounded shadow-lg border"
              style={{ left: textOverlay.cssX, top: textOverlay.cssY, transform: "translate(-50%, -50%)" }}
            >
              <input
                type="text"
                value={textOverlay.value}
                onChange={(e) => setTextOverlay((t) => ({ ...t, value: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (textOverlay.mode === "shape" && textOverlay.targetIndex !== null) {
                      const txt = textOverlay.value.trim()
                      if (txt) {
                        setStrokes((prev) =>
                          prev.map((s, i) =>
                            i === textOverlay.targetIndex && (s.tool === "rectangle" || s.tool === "ellipse")
                              ? ({ ...s, text: txt } as AnyStroke)
                              : s,
                          ),
                        )
                      }
                    } else if (textOverlay.mode === "text" && textOverlay.naturalPos) {
                      const txt = textOverlay.value.trim()
                      if (txt) {
                        const ts: TextStroke = {
                          tool: "text",
                          color,
                          lineWidth,
                          isMask: false,
                          position: textOverlay.naturalPos,
                          text: txt,
                          fontSize: 24,
                        }
                        setStrokes((prev) => [...prev, ts])
                        setRedoStack([])
                      }
                    }
                    setTextOverlay((t) => ({ ...t, active: false, value: "", targetIndex: null }))
                  }
                  if (e.key === "Escape") {
                    setTextOverlay((t) => ({ ...t, active: false, value: "", targetIndex: null }))
                  }
                }}
                placeholder={textOverlay.mode === "shape" ? "Enter label..." : "Enter text..."}
                className="border rounded px-2 py-1"
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="absolute bottom-4 right-4 flex items-center gap-2">
          <div className="text-xs text-gray-600 bg-white/70 px-2 py-1 rounded border">
            {tool.toUpperCase()} • {lineWidth}px
          </div>
          <Button onClick={() => handleSave()} className="bg-[#a7c19c] hover:bg-[#95b089] text-gray-800">
            <Download className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </div>
    </div>
  )
})

export default CanvasEditor

/*
Usage with ref:

import { useRef } from "react"
import CanvasEditor, { type CanvasEditorHandle } from "@/components/canvas-editor"

function Parent() {
  const editorRef = useRef<CanvasEditorHandle>(null)

  const exportMask = async () => {
    const blob = await editorRef.current?.getMaskBlob()
    if (!blob) return
    // do something with blob
  }

  const exportModified = async () => {
    const blob = await editorRef.current?.getModifiedBlob()
    if (!blob) return
    // do something with blob
  }

  return <CanvasEditor ref={editorRef} image="/path.png" onSave={() => {}} onClose={() => {}} />
}
*/
